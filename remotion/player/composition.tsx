import { AbsoluteFill, Img, useCurrentFrame } from "remotion";
import { SequenceItem } from "./sequence-item";
import { groupTrackItems } from "../utils/track-items";
import { TransitionSeries, Transitions } from "@designcombo/transitions";
import { ITrackItem, ITransition } from "@designcombo/types";
import { VideoEditorSchemaProps } from "../schema";
import { getBackgroundFillStyle } from "./styles";
import { isSceneItem } from "../types/ensemble-scene";

interface GroupEntry {
  id: string;
  type: string;
}

// TransitionSeries' contract is positional: every Transition must sit
// between two Sequences. Anything that removes a member from a group
// after grouping — a hidden item, a nested scene we refuse to recurse
// into, an item whose id no longer resolves — can leave a transition
// leading, trailing, or back-to-back with another transition, and
// Remotion throws on the malformed child list rather than skipping it.
// Drop those transitions instead of handing over a group that can't
// render.
function dropDanglingTransitions(group: GroupEntry[]): GroupEntry[] {
  return group.filter((entry, i) => {
    if (entry.type !== "transition") return true;
    const before = group[i - 1];
    const after = group[i + 1];
    return (
      !!before && before.type !== "transition" &&
      !!after && after.type !== "transition"
    );
  });
}

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

  const isRenderable = (g: GroupEntry) => {
    if (g.type === "transition") return !!typedTransitionsMap[g.id];
    const item = typedTrackItemsMap[g.id];
    if (!item) return false;
    if (item.details?.hidden) return false;
    // A scene inside a scene would recurse into its own player; the
    // nested layer is a flat snapshot by design. The render server only
    // ever renders the top-level composition, so `nested` is always
    // false here — this guard exists for parity with renderVisibleItems
    // in case a malformed project ever nests scenes at the top level.
    return true;
  };

  const visibleGroupedItems = groupedItems
    .map((group) => dropDanglingTransitions(group.filter(isRenderable)))
    .filter((group) => group.length > 0);

  const renderItem = (id: string, isTransition: boolean) => {
    const item = typedTrackItemsMap[id];
    return SequenceItem[item.type](item, {
      fps,
      size,
      frame,
      isTransition,
      nested: false
    });
  };

  return (
    <AbsoluteFill style={getBackgroundFillStyle(background?.type === "color" ? background.value : "#000000")}>
      {/*{background?.type === "image" && (*/}
      {/*  <Img*/}
      {/*    src={background.value}*/}
      {/*    style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover" }}*/}
      {/*  />*/}
      {/*)}*/}

      {visibleGroupedItems.map((group, index) => {
        const hasTransition = group.some((g) => g.type === "transition");

        // Either a lone item, or a group whose transitions all got
        // dropped above. Render the members as plain sequences — a
        // TransitionSeries with no transitions in it is just a
        // stricter Series.
        if (!hasTransition) {
          return group.map((g) => renderItem(g.id, false));
        }

        const firstItem = typedTrackItemsMap[group[0].id];
        const rawFrom = (firstItem.display.from / 1000) * fps;
        const from = Number.isFinite(rawFrom) ? rawFrom : 0;

        const children = group.map((g) => {
          if (g.type === "transition") {
            const t = typedTransitionsMap[g.id];
            const rawDuration = (t.duration / 1000) * fps;
            const isBad = !Number.isFinite(rawDuration) || rawDuration <= 0;
            if (isBad) {
              console.warn("[transition-nan-guard] bad transition duration, clamped", {
                transitionId: t.id,
                rawDuration: t.duration,
                fromId: (t as any).fromId,
                toId: (t as any).toId
              });
            }
            return Transitions[t.kind]({
              durationInFrames: isBad ? 1 : Math.round(rawDuration),
              ...size,
              id: t.id,
              direction: t.direction
            });
          }
          return renderItem(g.id, true);
        });

        return (
          <TransitionSeries from={from} key={index}>
            {children.filter(Boolean)}
          </TransitionSeries>
        );
      })}
    </AbsoluteFill>
  );
};

export default Composition;