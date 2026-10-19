import { CircleIcon, PaletteIcon } from "lucide-react";
import { LINE_WIDTHS, MEASURE_COLORS } from "~/lib/sheet-measure-color";
import type { DrawingWheelItem } from "./DrawingQuickWheel";

export function drawingWheelStyleItems({
  color,
  width,
  onColor,
  onWidth,
  onCustom,
}: {
  color: string;
  width?: number;
  onColor: (color: string) => void;
  onWidth?: (width: number) => void;
  onCustom: () => void;
}): DrawingWheelItem[] {
  return [
    {
      id: "colour",
      label: "Colour",
      icon: <PaletteIcon />,
      children: [
        ...MEASURE_COLORS.map((option) => ({
          id: option.value,
          label: option.name,
          icon: <CircleIcon fill={option.value} stroke="currentColor" />,
          selected: color.slice(0, 7).toLowerCase() === option.value,
          run: () => onColor(option.value),
        })),
        { id: "custom", label: "Custom colour", run: onCustom },
      ],
    },
    ...(onWidth
      ? [
          {
            id: "width",
            label: "Line width",
            children: LINE_WIDTHS.map((value) => ({
              id: String(value),
              label: `Width ${value}`,
              selected: width === value,
              run: () => onWidth(value),
            })),
          },
        ]
      : []),
  ];
}
