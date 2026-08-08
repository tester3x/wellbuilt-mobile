import fs from 'fs';

const en = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8'));
const es = JSON.parse(fs.readFileSync('src/i18n/locales/es.json', 'utf8'));

en.well = en.well || {};
es.well = es.well || {};
en.well.ready = en.well.ready || 'Ready';
es.well.ready = es.well.ready || 'Listo';
en.well.readyWithLoads_one = 'Ready ({{count}} load)';
en.well.readyWithLoads_other = 'Ready ({{count}} loads)';
es.well.readyWithLoads_one = 'Listo ({{count}} carga)';
es.well.readyWithLoads_other = 'Listo ({{count}} cargas)';
en.well.noFlowData = en.well.noFlowData || 'No flow data';
es.well.noFlowData = es.well.noFlowData || 'Sin datos de flujo';
en.well.readyWithLoads = 'Ready ({{count}})';
es.well.readyWithLoads = 'Listo ({{count}})';

en.history.pullsCount_one = '{{count}} pull';
en.history.pullsCount_other = '{{count}} pulls';
es.history.pullsCount_one = '{{count}} extracción';
es.history.pullsCount_other = '{{count}} extracciones';
en.history.footerTotals = '{{pulls}} • {{bbls}} BBLs';
es.history.footerTotals = '{{pulls}} • {{bbls}} BBLs';

Object.assign(en.manager, {
  tabProduction: 'Production',
  roleViewer: 'Viewer',
  roleDriver: 'Driver',
  roleAdmin: 'Admin',
  roleViewerDesc: 'Can view wells, cannot submit pulls',
  roleDriverDesc: 'Can view wells and submit pulls',
  roleAdminDesc: 'Can manage drivers, view performance',
  selectRole: 'Select Role:',
  selectNewRole: 'Select New Role:',
  changeRole: 'Change Role',
  update: 'Update',
  roleUpdated: 'Updated',
  roleUpdatedMessage: '{{name}} is now a {{role}}',
  errorUpdateRole: 'Could not update role',
  errorRegisterDevice: 'Could not register device',
  errorRemoveDevice: 'Could not remove device',
  errorCleanupLogs: 'Could not cleanup logs',
  errorDeleteLogs: 'Could not delete some logs',
  cleanupComplete: 'Cleanup Complete',
  cleanupDeleted: 'Deleted {{count}} old log entries.',
  deletedLogs: 'Deleted',
  deletedLogsMessage: 'Removed {{count}} logs',
  performanceTracker: 'Performance Tracker',
  performanceSubtitle: 'View prediction accuracy',
  badgeViewer: 'VIEWER',
  badgeDriver: 'DRIVER',
  badgeAdmin: 'ADMIN',
  role: 'Role',
  noProductionData: 'No production data yet',
  colWell: 'Well',
  colPulls: 'Pulls',
  filterLocal: 'Local',
  filterSystem: 'System',
  filterError: 'Error',
  filterDebug: 'Debug',
  filterAll: 'All',
  longPressSelect: 'Long-press any log to select',
  selectAll: 'All',
  cancel: 'Cancel',
  approveName: 'Approve {{name}}?',
  networkError: 'Network error. Please try again.',
  serverError: 'Server error. Please try again.',
  genericError: 'Something went wrong. Please try again.',
});
Object.assign(es.manager, {
  tabProduction: 'Producción',
  roleViewer: 'Visor',
  roleDriver: 'Conductor',
  roleAdmin: 'Admin',
  roleViewerDesc: 'Puede ver pozos, no puede registrar extracciones',
  roleDriverDesc: 'Puede ver pozos y registrar extracciones',
  roleAdminDesc: 'Puede administrar conductores y ver rendimiento',
  selectRole: 'Seleccionar Rol:',
  selectNewRole: 'Seleccionar Nuevo Rol:',
  changeRole: 'Cambiar Rol',
  update: 'Actualizar',
  roleUpdated: 'Actualizado',
  roleUpdatedMessage: '{{name}} ahora es {{role}}',
  errorUpdateRole: 'No se pudo actualizar el rol',
  errorRegisterDevice: 'No se pudo registrar el dispositivo',
  errorRemoveDevice: 'No se pudo quitar el dispositivo',
  errorCleanupLogs: 'No se pudieron limpiar los registros',
  errorDeleteLogs: 'No se pudieron eliminar algunos registros',
  cleanupComplete: 'Limpieza Completa',
  cleanupDeleted: 'Se eliminaron {{count}} registros antiguos.',
  deletedLogs: 'Eliminado',
  deletedLogsMessage: 'Se eliminaron {{count}} registros',
  performanceTracker: 'Seguimiento de Rendimiento',
  performanceSubtitle: 'Ver precisión de predicción',
  badgeViewer: 'VISOR',
  badgeDriver: 'CONDUCTOR',
  badgeAdmin: 'ADMIN',
  role: 'Rol',
  noProductionData: 'Sin datos de producción aún',
  colWell: 'Pozo',
  colPulls: 'Extracciones',
  filterLocal: 'Local',
  filterSystem: 'Sistema',
  filterError: 'Error',
  filterDebug: 'Depuración',
  filterAll: 'Todo',
  longPressSelect: 'Mantenga presionado un registro para seleccionar',
  selectAll: 'Todo',
  cancel: 'Cancelar',
  approveName: '¿Aprobar a {{name}}?',
  networkError: 'Error de red. Inténtelo de nuevo.',
  serverError: 'Error del servidor. Inténtelo de nuevo.',
  genericError: 'Algo salió mal. Inténtelo de nuevo.',
});

en.performance = {
  title: 'Performance',
  subtitle: 'Select a well to view',
  myRoutes: 'My Routes ({{count}})',
  allWells: 'All Wells ({{count}})',
  loadingWells: 'Loading wells...',
  loadFailed: 'Failed to load wells',
  retry: 'Retry',
  empty: 'No wells found',
  testTag: '[TEST]',
  detailSubtitle: 'Tap to switch wells',
  loadingWellData: 'Loading {{wellName}} data...',
  noDataForWell: 'No data found for {{wellName}}',
  fetchFailed: 'Failed to fetch data',
  done: 'Done',
  best: 'Best ↓',
  worst: 'Worst ↓',
  myRoutesFilter: 'My Routes',
  allFilter: 'All',
};
es.performance = {
  title: 'Rendimiento',
  subtitle: 'Seleccione un pozo para ver',
  myRoutes: 'Mis Rutas ({{count}})',
  allWells: 'Todos los Pozos ({{count}})',
  loadingWells: 'Cargando pozos...',
  loadFailed: 'Error al cargar pozos',
  retry: 'Reintentar',
  empty: 'No se encontraron pozos',
  testTag: '[PRUEBA]',
  detailSubtitle: 'Toque para cambiar de pozo',
  loadingWellData: 'Cargando datos de {{wellName}}...',
  noDataForWell: 'No hay datos para {{wellName}}',
  fetchFailed: 'Error al obtener datos',
  done: 'Listo',
  best: 'Mejor ↓',
  worst: 'Peor ↓',
  myRoutesFilter: 'Mis Rutas',
  allFilter: 'Todos',
};

en.errors = {
  network: 'Network error. Please try again.',
  server: 'Server error. Please try again.',
  timeout: 'Connection timed out. Please try again.',
  unknown: 'Something went wrong. Please try again.',
  firebaseRead: 'Could not load data. Please try again.',
  firebaseWrite: 'Could not save data. Please try again.',
};
es.errors = {
  network: 'Error de red. Inténtelo de nuevo.',
  server: 'Error del servidor. Inténtelo de nuevo.',
  timeout: 'Tiempo de conexión agotado. Inténtelo de nuevo.',
  unknown: 'Algo salió mal. Inténtelo de nuevo.',
  firebaseRead: 'No se pudieron cargar los datos. Inténtelo de nuevo.',
  firebaseWrite: 'No se pudieron guardar los datos. Inténtelo de nuevo.',
};

fs.writeFileSync('src/i18n/locales/en.json', JSON.stringify(en, null, 2) + '\n');
fs.writeFileSync('src/i18n/locales/es.json', JSON.stringify(es, null, 2) + '\n');

function flatten(o, p = '') {
  let k = [];
  for (const [a, b] of Object.entries(o || {})) {
    const n = p ? `${p}.${a}` : a;
    if (b && typeof b === 'object' && !Array.isArray(b)) k = k.concat(flatten(b, n));
    else k.push(n);
  }
  return k;
}
const ek = flatten(en);
const sk = flatten(es);
console.log(
  'keys',
  ek.length,
  sk.length,
  'onlyEn',
  ek.filter((k) => !sk.includes(k)),
  'onlyEs',
  sk.filter((k) => !ek.includes(k)),
);
