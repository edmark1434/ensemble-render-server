import { Composition } from "remotion";
import { videoEditorSchema } from "./schema";
import VideoEditorComposition from "./player/composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VideoEditor"
        component={VideoEditorComposition}
        schema={videoEditorSchema}
        fps={30}
        width={1920}
        height={1080}
        durationInFrames={300}
        defaultProps={{
          trackItemIds: [],
          trackItemsMap: {},
          transitionsMap: {},
          fps: 30,
          size: { width: 1920, height: 1080 },
          duration: 10000
        }}
        calculateMetadata={async ({ props }) => {
          const frames = Math.round((props.duration / 1000) * props.fps) + 1;
          return {
            durationInFrames: Number.isFinite(frames) && frames > 0 ? frames : 1,
            fps: props.fps,
            width: props.size.width,
            height: props.size.height
          };
        }}
      />
    </>
  );
};