import { IAudio } from "@designcombo/types";
import { BaseSequence, SequenceItemOptions } from "../base-sequence";
import { Html5Audio } from "remotion";

export default function Audio({
  item,
  options
}: {
  item: IAudio;
  options: SequenceItemOptions;
}) {
  const { fps } = options;
  const { details } = item;
  const playbackRate = item.playbackRate || 1;

  const trimFrom = item.trim?.from ?? 0;
  const trimTo = item.trim?.to ?? item.display.to - item.display.from;

  const children = (
    <Html5Audio
      trimBefore={(trimFrom / 1000) * fps}
      trimAfter={(trimTo / 1000) * fps || 1 / fps}
      playbackRate={playbackRate}
      src={details.src}
      volume={() => (details.volume ?? 100) / 100}
    />
  );
  return BaseSequence({ item, options, children });
}