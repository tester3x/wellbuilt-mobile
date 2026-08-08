import fs from 'fs';

// performance.tsx
let p = fs.readFileSync('app/performance.tsx', 'utf8');
if (!p.includes("useTranslation")) {
  p = p.replace(
    'import { useSafeAreaInsets } from "react-native-safe-area-context";',
    `import { useSafeAreaInsets } from "react-native-safe-area-context";\nimport { useTranslation } from "react-i18next";\nimport { userFacingErrorMessage } from "../src/i18n/userFacingError";`,
  );
  p = p.replace(
    'export default function PerformanceScreen() {\n  const router = useRouter();\n  const insets = useSafeAreaInsets();',
    `export default function PerformanceScreen() {\n  const router = useRouter();\n  const insets = useSafeAreaInsets();\n  const { t } = useTranslation();`,
  );
}
p = p.replace(
  'setError(err instanceof Error ? err.message : "Failed to load wells");',
  "setError(userFacingErrorMessage(err));",
);
p = p.replace(
  '{item.name}\n          {isTestRoute ? " [TEST]" : ""}',
  "{item.name}\n          {isTestRoute ? ` ${t('performance.testTag')}` : ''}",
);
p = p.replace(
  '<Text style={styles.headerTitle}>Performance</Text>',
  "<Text style={styles.headerTitle}>{t('performance.title')}</Text>",
);
p = p.replace(
  '<Text style={styles.headerSubtitle}>Select a well to view</Text>',
  "<Text style={styles.headerSubtitle}>{t('performance.subtitle')}</Text>",
);
p = p.replace(
  'My Routes ({selectedWells.size})',
  "{t('performance.myRoutes', { count: selectedWells.size })}",
);
p = p.replace(
  'All Wells ({allWells.length})',
  "{t('performance.allWells', { count: allWells.length })}",
);
p = p.replace(
  'Loading wells...',
  "{t('performance.loadingWells')}",
);
p = p.replace(
  '<Text style={styles.retryButtonText}>Retry</Text>',
  "<Text style={styles.retryButtonText}>{t('performance.retry')}</Text>",
);
fs.writeFileSync('app/performance.tsx', p);
console.log('performance.tsx done');

// performance-detail.tsx
let d = fs.readFileSync('app/performance-detail.tsx', 'utf8');
if (!d.includes('useTranslation')) {
  d = d.replace(
    'import { useSafeAreaInsets } from "react-native-safe-area-context";',
    `import { useSafeAreaInsets } from "react-native-safe-area-context";\nimport { useTranslation } from "react-i18next";\nimport { userFacingErrorMessage } from "../src/i18n/userFacingError";\nimport { formatAppNumber } from "../src/i18n/format";`,
  );
  // find component start
  d = d.replace(
    /export default function PerformanceDetailScreen\(\) \{\n  const router = useRouter\(\);\n  const insets = useSafeAreaInsets\(\);/,
    `export default function PerformanceDetailScreen() {\n  const router = useRouter();\n  const insets = useSafeAreaInsets();\n  const { t } = useTranslation();`,
  );
}
// if pattern different, try insert after first useRouter
if (!d.includes("const { t } = useTranslation()")) {
  d = d.replace(
    'const router = useRouter();',
    "const router = useRouter();\n  const { t } = useTranslation();",
  );
}
d = d.replace(
  'setError(`No data found for ${currentWellName}`);',
  "setError(t('performance.noDataForWell', { wellName: currentWellName }));",
);
d = d.replace(
  'setError(err instanceof Error ? err.message : "Failed to fetch data");',
  "setError(userFacingErrorMessage(err));",
);
d = d.replace(
  '<Text style={styles.headerSubtitle}>Tap to switch wells</Text>',
  "<Text style={styles.headerSubtitle}>{t('performance.detailSubtitle')}</Text>",
);
d = d.replace(
  'Loading {currentWellName} data...',
  "{t('performance.loadingWellData', { wellName: currentWellName })}",
);
d = d.replace(
  '<Text style={styles.retryButtonText}>Retry</Text>',
  "<Text style={styles.retryButtonText}>{t('performance.retry')}</Text>",
);
d = d.replace(
  '>Done<',
  ">{t('performance.done')}<",
);
d = d.replace(
  '>Best ↓<',
  ">{t('performance.best')}<",
);
d = d.replace(
  '>Worst ↓<',
  ">{t('performance.worst')}<",
);
// filter buttons My Routes / All if present
d = d.replace(
  /My Routes/g,
  "{t('performance.myRoutesFilter')}",
);
// careful - might break comments
fs.writeFileSync('app/performance-detail.tsx', d);
console.log('performance-detail.tsx done');
