import { AbsoluteFill, Img, useCurrentFrame } from "remotion";
import { SequenceItem } from "./sequence-item";
import { groupTrackItems } from "../utils/track-items";
import { TransitionSeries, Transitions } from "@designcombo/transitions";
import { ITrackItem, ITransition } from "@designcombo/types";
import { VideoEditorSchemaProps } from "../schema";
import { getBackgroundFillStyle } from "./styles";

const Composition: React.FC<VideoEditorSchemaProps> = ({
  trackItemIds,
  trackItemsMap,
  transitionsMap,
  fps,
  size,
  background
}) => {
  const frame = useCurrentFrame();
  const typedTrackItemsMap = trackItemsMap as Record<string, ITrackItem>;
  const typedTransitionsMap = transitionsMap as Record<string, ITransition>;

  const groupedItems = groupTrackItems({
    trackItemIds,
    transitionsMap: typedTransitionsMap,
    trackItemsMap: typedTrackItemsMap
  });

  const visibleGroupedItems = groupedItems
    .map((group) =>
      group.filter((item) => {
        if (item.type === "transition") return true;
        return !typedTrackItemsMap[item.id]?.details?.hidden;
      })
    )
    .filter((group) => group.length > 0);

  return (
    <AbsoluteFill style={getBackgroundFillStyle(background?.type === "color" ? background.value : "#000000")}>
      {/*{background?.type === "image" && (*/}
      {/*  <Img*/}
      {/*    src={background.value}*/}
      {/*    style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover" }}*/}
      {/*  />*/}
      {/*)}*/}

      {visibleGroupedItems.map((group, index) => {
        if (group.length === 1) {
          const item = typedTrackItemsMap[group[0].id];
          return SequenceItem[item.type](item, {
            fps,
            frame,
            size,
            isTransition: false
          });
        }
        const firstItem = typedTrackItemsMap[group[0].id];
        const from = (firstItem.display.from / 1000) * fps;
        return (
          <TransitionSeries from={from} key={index}>
            {group.map((item) => {
              if (item.type === "transition") {
                const durationInFrames = (item.duration / 1000) * fps;
                return Transitions[item.kind]({
                  durationInFrames,
                  ...size,
                  id: item.id,
                  direction: item.direction
                });
              }
              return SequenceItem[item.type](typedTrackItemsMap[item.id], {
                fps,
                isTransition: true,
                size,
                frame
              });
            })}
          </TransitionSeries>
        );
      })}
    </AbsoluteFill>
  );
};

export default Composition;