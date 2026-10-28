import { Slider, type SliderProps } from '@miblanchard/react-native-slider';

// Give each existing level step almost three times as much finger travel.
export const LEVEL_TIME_DRAG_GAIN = 0.35;
export type LevelTimeSliderProps = SliderProps & { dragGain?: number };

/** Retain the installed slider's rendering, bounds, stepping and callbacks. */
export class LevelTimeSlider extends Slider {
  declare props: Readonly<LevelTimeSliderProps>;
  constructor(props: LevelTimeSliderProps) {
    super(props);
    const valueFromGesture = this._getValue;
    this._getValue = gesture => valueFromGesture({
      ...gesture,
      dx: gesture.dx * (this.props.dragGain ?? LEVEL_TIME_DRAG_GAIN),
      dy: gesture.dy * (this.props.dragGain ?? LEVEL_TIME_DRAG_GAIN),
    });
  }
}
