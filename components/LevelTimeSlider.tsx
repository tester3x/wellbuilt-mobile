import { Slider, type SliderProps } from '@miblanchard/react-native-slider';

// Give each existing level step almost three times as much finger travel.
export const LEVEL_TIME_DRAG_GAIN = 0.35;
export type LevelTimeSliderProps = SliderProps & { dragGain?: number; layoutScale?: number };

/** Retain the installed slider's rendering, bounds, stepping and callbacks. */
export class LevelTimeSlider extends Slider {
  props: Readonly<LevelTimeSliderProps>;
  constructor(props: LevelTimeSliderProps) {
    super(props);
    this.props = props;
    const valueFromGesture = this._getValue;
    // Native gesture deltas are physical pixels; the fitted panel's track is
    // measured in logical coordinates. Keep travel proportional after scaling.
    this._getValue = gesture => valueFromGesture({
      ...gesture,
      dx: gesture.dx * (this.props.dragGain ?? LEVEL_TIME_DRAG_GAIN) / Math.max(0.01,this.props.layoutScale ?? 1),
      dy: gesture.dy * (this.props.dragGain ?? LEVEL_TIME_DRAG_GAIN) / Math.max(0.01,this.props.layoutScale ?? 1),
    });
  }
}
