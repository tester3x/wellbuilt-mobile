import { Dimensions, PixelRatio, Platform } from "react-native";
import {
  widthPercentageToDP as wp,
  heightPercentageToDP as hp,
} from "react-native-responsive-screen";

export { wp, hp };

// Some handy spacing helpers
export const spacing = {
  xs: hp("0.5%"),
  sm: hp("1%"),
  md: hp("2%"),
  lg: hp("3%"),
  xl: hp("4%"),
};

// Device detection and responsive scaling
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// Tablet detection:
// - Screen width > 600dp typically indicates tablet
// - Also check aspect ratio - tablets tend to be more square
const screenWidthDp = SCREEN_WIDTH / PixelRatio.get();
const aspectRatio = SCREEN_HEIGHT / SCREEN_WIDTH;
export const isTablet = SCREEN_WIDTH >= 600 || (Platform.OS === "android" && screenWidthDp >= 600);

// Scale factor for tablet vs phone
// Tablets need smaller relative sizes to not look oversized
export const deviceScale = isTablet ? 0.7 : 1.0;

// Get responsive tank dimensions
// On phones: tank takes ~70% of screen width
// On tablets: tank should be constrained to look proportional
export function getTankDimensions() {
  const screenWidth = Dimensions.get("window").width;
  const screenHeight = Dimensions.get("window").height;

  // On tablets, constrain tank to reasonable size
  // Use the smaller dimension to ensure it fits
  let tankWidth: number;
  let tankHeight: number;

  if (isTablet) {
    // On tablets, base tank size on height to prevent oversized tanks
    // Tank should be about 40% of screen height, maintaining aspect ratio
    tankHeight = screenHeight * 0.42;
    tankWidth = tankHeight / 1.2; // Maintain aspect ratio (height = width * 1.2)
  } else {
    // On phones, use width-based sizing
    tankWidth = screenWidth * 0.70;
    tankHeight = tankWidth * 1.2;
  }

  // Interior margins (proportional to tank size)
  const interiorLeft = tankWidth * 0.26;
  const interiorRight = tankWidth * 0.26;
  const interiorTop = tankHeight * 0.14;
  const interiorBottom = tankHeight * 0.16;
  const interiorHeight = tankHeight - interiorTop - interiorBottom;

  return {
    tankWidth,
    tankHeight,
    interiorLeft,
    interiorRight,
    interiorTop,
    interiorBottom,
    interiorHeight,
  };
}

// Responsive font scaling
// Returns scaled font size that works well on both phones and tablets
export function responsiveFontSize(baseSize: number): number {
  if (isTablet) {
    // On tablets, reduce font scale factor
    return Math.round(baseSize * 0.85);
  }
  return Math.round(baseSize);
}

// Responsive spacing that adapts to device
export function responsiveSpacing(baseSpacing: number): number {
  if (isTablet) {
    return baseSpacing * 0.8;
  }
  return baseSpacing;
}
