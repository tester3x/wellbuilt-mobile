import { Slider, type SliderProps } from '@miblanchard/react-native-slider';

// Give each existing level step almost three times as much finger travel.
export const LEVEL_TIME_DRAG_GAIN = 0.35;

/** Retain the installed slider's rendering, bounds, stepping and callbacks. */
export class LevelTimeSlider extends Slider {
  constructor(props: SliderProps) {
    super(props);
    const valueFromGesture = this._getValue;
    this._getValue = gesture => valueFromGesture({
      ...gesture,
      dx: gesture.dx * LEVEL_TIME_DRAG_GAIN,
      dy: gesture.dy * LEVEL_TIME_DRAG_GAIN,
    });
  }
}
