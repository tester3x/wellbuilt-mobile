export type PipelineConfig = {
  isDown?: boolean; routeType?: string; tankHeight?: number; bblPerFoot?: number;
  pipelineOperation?: {mode:string;holdingLevelFeet:number;productionMinutesPerFoot:number;levelBasis:string};
};
/** Display assumption, never a measured last-pull level. Gross production is
 * retained even though the pipeline balances net tank accumulation to zero. */
export function pipelineDisplay(config: PipelineConfig | null | undefined) {
  const p=config?.pipelineOperation;
  if(!p || p.mode!=='running' || config?.isDown===true || config?.routeType==='freshwater'
    || !Number.isFinite(p.holdingLevelFeet) || p.holdingLevelFeet<0
    || !Number.isFinite(config?.tankHeight) || (config?.tankHeight||0)<=0 || p.holdingLevelFeet>config!.tankHeight!
    || !Number.isFinite(p.productionMinutesPerFoot) || p.productionMinutesPerFoot<=0)return null;
  return {holdingLevelFeet:p.holdingLevelFeet,productionMinutesPerFoot:p.productionMinutesPerFoot,
    productionBblsDay:Math.round((config?.bblPerFoot||0)*1440/p.productionMinutesPerFoot),assumed:p.levelBasis!=='confirmed'};
}

let configReader:(wellName:string)=>PipelineConfig|undefined=()=>undefined;
/** Read through the existing account-scoped catalog; keep snapshot hot paths free
 * of a new Firebase/SecureStore dependency and avoid a second config cache. */
export function registerPipelineConfigReader(reader:typeof configReader){configReader=reader;}
export function pipelineConfigForWell(wellName:string){return configReader(wellName);}
