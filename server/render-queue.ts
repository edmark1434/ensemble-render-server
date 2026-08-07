import {
  makeCancelSignal,
  renderMedia,
  renderStill,
  renderFrames,
  selectComposition,
} from "@remotion/renderer";
import type { Codec } from "@remotion/renderer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { ZipArchive } from "archiver";
import type { VideoEditorSchemaProps } from "../remotion/schema";

type JobData = VideoEditorSchemaProps;

type JobState =
  | {
  status: "queued";
  data: JobData;
  cancel: () => void;
}
  | {
  status: "in-progress";
  progress: number;
  data: JobData;
  cancel: () => void;
}
  | {
  status: "completed";
  videoUrl: string;
  data: JobData;
}
  | {
  status: "failed";
  error: Error;
  data: JobData;
};

const compositionId = "VideoEditor";

// video/audio containers -> Remotion codec + output file extension
const MEDIA_FORMAT_MAP: Record<string, { codec: Codec; ext: string }> = {
  mp4: { codec: "h264", ext: "mp4" },
  mov: { codec: "prores", ext: "mov" },
  mkv: { codec: "h264-mkv", ext: "mkv" },
  gif: { codec: "gif", ext: "gif" },
  mp3: { codec: "mp3", ext: "mp3" },
  wav: { codec: "wav", ext: "wav" },
  aac: { codec: "aac", ext: "aac" },
};

// still-image formats -> Remotion imageFormat (shared by "image" and "image-sequence" types)
const STILL_FORMAT_MAP: Record<string, "png" | "jpeg"> = {
  png: "png",
  jpeg: "jpeg",
};

const zipDirectory = (sourceDir: string, outputZipPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputZipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", (err: Error) => reject(err));
    archive.on("error", (err: Error) => reject(err));

    archive.pipe(output);
    // `false` = don't nest files under a subfolder, put them at the zip root
    archive.directory(sourceDir, false);
    archive.finalize();
  });
};

export const makeRenderQueue = ({
  port,
  serveUrl,
  rendersDir,
}: {
  port: number;
  serveUrl: string;
  rendersDir: string;
}) => {
  const jobs = new Map<string, JobState>();
  const cancelledJobIds = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  // Checks whether a job was cancelled mid-render. If so, cleans up any
  // partial output and removes the job from the map. Call this right after
  // any render call resolves, BEFORE marking the job "completed" - Remotion's
  // cancelSignal doesn't guarantee the render promise rejects in every case
  // (e.g. cancellation arriving right as muxing/writing finishes), so without
  // this check a cancelled job can still race its way to "completed".
  const handleIfCancelled = async (
    jobId: string,
    cleanupPaths: string[] = []
  ): Promise<boolean> => {
    if (!cancelledJobIds.has(jobId)) return false;

    cancelledJobIds.delete(jobId);
    console.info(`Render ${jobId} was cancelled.`);

    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }

    jobs.delete(jobId);
    return true;
  };

  const processRender = async (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) {
      // job cancelled while queued, nothing to render
      return;
    }

    const { cancel, cancelSignal } = makeCancelSignal();

    const cancelHandler = () => {
      cancelledJobIds.add(jobId);
      cancel();
    };

    jobs.set(jobId, {
      progress: 0,
      status: "in-progress",
      cancel: cancelHandler,
      data: job.data,
    });

    // pass the whole payload through - selectComposition/renderMedia/
    // renderStill/renderFrames validate inputProps against the composition's
    // schema, so every field the schema requires has to be present here
    const inputProps = job.data;

    // tracks the output path(s) for this job so a late cancellation can
    // clean up whatever was written before the promise settled
    let expectedOutputPaths: string[] = [];

    try {
      const composition = await selectComposition({
        serveUrl,
        id: compositionId,
        inputProps,
      });

      if (job.data.type === "image") {
        const imageFormat = STILL_FORMAT_MAP[job.data.format];
        if (!imageFormat) {
          throw new Error(`Unsupported image format for stills: ${job.data.format}`);
        }

        const frame = Math.round(((job.data.currentTime ?? 0) / 1000) * job.data.fps);
        const outputPath = path.join(rendersDir, `${jobId}.${job.data.format}`);
        expectedOutputPaths = [outputPath];

        await renderStill({
          serveUrl,
          composition,
          inputProps,
          imageFormat,
          frame,
          output: outputPath,
          cancelSignal,
          onBrowserLog: (info) => {
            console.log(`[browser] ${info.type}: ${info.text}`);
          },
        });

        if (await handleIfCancelled(jobId, expectedOutputPaths)) return;

        jobs.set(jobId, {
          status: "completed",
          videoUrl: `http://localhost:${port}/renders/${jobId}.${job.data.format}`,
          data: job.data,
        });
        return;
      }

      if (job.data.type === "image-sequence") {
        const imageFormat = STILL_FORMAT_MAP[job.data.format];
        if (!imageFormat) {
          throw new Error(`Unsupported image format for image sequences: ${job.data.format}`);
        }

        const framesDir = path.join(rendersDir, `${jobId}-frames`);
        const zipPath = path.join(rendersDir, `${jobId}.zip`);
        expectedOutputPaths = [framesDir, zipPath];

        await fs.mkdir(framesDir, { recursive: true });

        const totalFrames = composition.durationInFrames || 1;

        await renderFrames({
          serveUrl,
          composition,
          inputProps,
          outputDir: framesDir,
          imageFormat,
          imageSequencePattern: "[frame].[ext]",
          cancelSignal,
          onStart: () => {
            console.info(`${jobId} frame render starting`);
          },
          onFrameUpdate: (framesRendered) => {
            const progress = framesRendered / totalFrames;
            console.info(`${jobId} render progress:`, progress);
            jobs.set(jobId, {
              progress,
              status: "in-progress",
              cancel: cancelHandler,
              data: job.data,
            });
          },
          onBrowserLog: (info) => {
            console.log(`[browser] ${info.type}: ${info.text}`);
          },
        });

        if (await handleIfCancelled(jobId, expectedOutputPaths)) return;

        await zipDirectory(framesDir, zipPath);
        // frames are safely zipped up, the loose files aren't needed anymore
        await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});

        if (await handleIfCancelled(jobId, [zipPath])) return;

        jobs.set(jobId, {
          status: "completed",
          videoUrl: `http://localhost:${port}/renders/${jobId}.zip`,
          data: job.data,
        });
        return;
      }

      const mediaFormat = MEDIA_FORMAT_MAP[job.data.format];
      if (!mediaFormat) {
        throw new Error(`Unsupported format for media render: ${job.data.format}`);
      }

      // resolution targets whichever dimension is shorter
      const shorterDimension = Math.min(job.data.size.width, job.data.size.height);
      const scale = job.data.resolution / shorterDimension;

      type FfmpegBitrate = `${number}k` | `${number}K` | `${number}M`;

      const toFfmpegBitrate = (kbps: number | null | undefined): FfmpegBitrate | undefined => {
        if (kbps == null) return undefined;
        return `${kbps}k`;
      };
      const bitrateArg = toFfmpegBitrate(job.data.bitrate);

      const isGif = mediaFormat.codec === "gif";
      const outputPath = path.join(rendersDir, `${jobId}.${mediaFormat.ext}`);
      expectedOutputPaths = [outputPath];

      await renderMedia({
        cancelSignal,
        serveUrl,
        composition,
        inputProps,
        codec: mediaFormat.codec,
        scale: job.data.type === "video" ? scale : undefined,
        videoBitrate: job.data.type === "video" && !isGif ? bitrateArg : undefined,
        audioBitrate: job.data.type === "audio" ? bitrateArg : undefined,
        audioCodec: mediaFormat.codec === "h264-mkv" ? "mp3" : undefined,
        onProgress: (progress) => {
          console.info(`${jobId} render progress:`, progress.progress);
          jobs.set(jobId, {
            progress: progress.progress,
            status: "in-progress",
            cancel: cancelHandler,
            data: job.data,
          });
        },
        outputLocation: outputPath,
        onBrowserLog: (info) => {
          console.log(`[browser] ${info.type}: ${info.text}`);
        },
      });

      if (await handleIfCancelled(jobId, expectedOutputPaths)) return;

      jobs.set(jobId, {
        status: "completed",
        videoUrl: `http://localhost:${port}/renders/${jobId}.${mediaFormat.ext}`,
        data: job.data,
      });
    } catch (error) {
      if (await handleIfCancelled(jobId, expectedOutputPaths)) return;

      console.error(error);
      jobs.set(jobId, {
        status: "failed",
        error: error as Error,
        data: job.data,
      });
    }
  };

  const queueRender = ({
    jobId,
    data,
  }: {
    jobId: string;
    data: JobData;
  }) => {
    jobs.set(jobId, {
      status: "queued",
      data,
      cancel: () => {
        console.info(`Render ${jobId} was cancelled.`);
        jobs.delete(jobId);
      },
    });

    queue = queue.then(() => processRender(jobId)).catch((error) => {
      console.error(`Unhandled error processing job ${jobId}:`, error);
    });
  };

  function createJob(data: JobData) {
    const jobId = randomUUID();

    queueRender({ jobId, data });

    return jobId;
  }

  return {
    createJob,
    jobs,
  };
};