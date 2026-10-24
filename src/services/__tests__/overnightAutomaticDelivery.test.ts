// Synthetic responses generated through the deployed server refresh helper.
// No real wells, accounts, driver records or cloud mutations are involved.
import sequence from './fixtures/overnightAutoResponses.json';
const mockStore:Record<string,string>={};
const mockCallbacks:any={};
let mockRestResponse:any=null;
let mockRevision='initial';
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{
 getItem:jest.fn(async(k:string)=>mockStore[k]??null),
 setItem:jest.fn(async(k:string,v:string)=>{mockStore[k]=v;}),
 removeItem:jest.fn(async(k:string)=>{delete mockStore[k];}),
}}));
jest.mock('../firebaseListener',()=>({
 subscribeToOutgoing:jest.fn((update:any,initial:any)=>{mockCallbacks.update=update;mockCallbacks.initial=initial;return jest.fn();}),
 watchIncomingRevisionV2:jest.fn((callback:any)=>{mockCallbacks.revision=callback;return jest.fn();}),
 isListening:jest.fn(()=>false),unsubscribeAll:jest.fn(),
}));
jest.mock('../driverAuth',()=>({getDriverId:jest.fn(async()=> 'test-driver')}));
jest.mock('../firebase',()=>({
 fetchDriverOutgoingStatus:jest.fn(async()=>({driverId:'test-driver',responses:[mockRestResponse],unavailableWells:[]})),
 fetchIncomingVersion:jest.fn(async()=>7),fetchIncomingRevisionV2:jest.fn(async()=>mockRevision),
}));
jest.mock('../wellAlerts',()=>({scheduleWellAlert:jest.fn(async()=>{})}));

describe('automatic ON delivery after new pulls',()=>{
 beforeEach(()=>{jest.resetModules();Object.keys(mockStore).forEach(k=>delete mockStore[k]);mockRestResponse=null;mockRevision='initial';});
 test('successive AFR changes persist and reach the screen through listener, foreground and revision recovery',async()=>{
  const sync=await import('../backgroundSync'),history=await import('../wellHistory');
  const screen=jest.fn();sync.onSyncStatusChange(screen);sync.startBackgroundSync();
  const response=(i:number,flowRate:string,bbls24hrs:string)=>({...sequence[i].response,flowRate,bbls24hrs,isEdit:false});
  const assertRate=(minutes:number,daily:number)=>{
   const snapshot=history.getLevelSnapshotSync('Example');
   expect(snapshot?.flowRateMinutes).toBe(minutes);
   // Same bank/rate conversion used by the well card: 60 BBL/ft.
   expect(Math.round(60*1440/snapshot!.flowRateMinutes!)).toBe(daily);
   expect(JSON.parse(mockStore['@wellbuilt_level_snapshots']).Example.flowRateMinutes).toBe(minutes);
   expect(screen).toHaveBeenLastCalledWith(false);
  };
  try{
   await mockCallbacks.initial({response_Example:response(0,'24:00:00','60')});assertRate(1440,60);
   await mockCallbacks.update('Example',response(1,'12:00:00','120'));assertRate(720,120);
   sync.stopBackgroundSync();mockRestResponse=response(2,'18:00:00','80');mockRevision='afr-foreground';
   await sync.syncOnForeground();assertRate(1080,80);
   sync.startBackgroundSync();mockRestResponse=response(3,'16:00:00','90');mockRevision='afr-revision';
   let unsubscribe=()=>{};
   const complete=new Promise<void>(resolve=>{let started=false;unsubscribe=sync.onSyncStatusChange(busy=>{if(busy)started=true;else if(started){unsubscribe();resolve();}});});
   mockCallbacks.revision('afr-revision');await complete;assertRate(960,90);
   await mockCallbacks.update('Example',response(0,'24:00:00','60'));assertRate(960,90);
  }finally{sync.stopBackgroundSync();}
 });
 test('initial restoration and successive listener events update durable snapshots and notify the screen',async()=>{
  const sync=await import('../backgroundSync'),history=await import('../wellHistory');
  const screen=jest.fn();sync.onSyncStatusChange(screen);sync.startBackgroundSync();
  try{
   await mockCallbacks.initial({response_Example:sequence[0].response});
   expect(history.getLevelSnapshotSync('Example')?.overnightBblsDay).toBe(160);
   for(const [i,expected]of [[1,160],[2,250],[3,81]]){
    await mockCallbacks.update('Example',{...sequence[i].response,isEdit:false});
    expect(history.getLevelSnapshotSync('Example')).toMatchObject({overnightBblsDay:expected,lastPullDateTimeUTC:sequence[i].response.lastPullDateTimeUTC});
    expect(screen).toHaveBeenLastCalledWith(false);
   }
   const saved=JSON.parse(mockStore['@wellbuilt_level_snapshots']).Example;
   expect(saved).toMatchObject({overnightBblsDay:81,levelFeet:10,overnightEstimatedTime:false});
   await mockCallbacks.update('Example',{...sequence[0].response,isEdit:false});
   expect(history.getLevelSnapshotSync('Example')).toMatchObject({overnightBblsDay:81,levelFeet:10,lastPullDateTimeUTC:sequence[3].response.lastPullDateTimeUTC});
  }finally{sync.stopBackgroundSync();}
 });
 test('foreground recovery fetches a pull missed while detached without manual refresh',async()=>{
  const sync=await import('../backgroundSync'),history=await import('../wellHistory');
  sync.startBackgroundSync();await mockCallbacks.initial({response_Example:sequence[0].response});sync.stopBackgroundSync();
  mockRestResponse=sequence[3].response;mockRevision='missed-new-gap';
  await sync.syncOnForeground();
  expect(history.getLevelSnapshotSync('Example')).toMatchObject({overnightBblsDay:81,levelFeet:10,lastPullDateTimeUTC:sequence[3].response.lastPullDateTimeUTC});
  expect((await import('../revisionV2')).peekAppliedRevisionV2()).toBe('missed-new-gap');
  expect(mockStore['@wbm_applied_revision_v2:test-driver']).toBeDefined();
  sync.stopBackgroundSync();
 });
 test('revision fallback automatically applies a new pull if the direct child event was missed',async()=>{
  const sync=await import('../backgroundSync'),history=await import('../wellHistory');
  sync.startBackgroundSync();
  try{
   await mockCallbacks.initial({response_Example:sequence[0].response});
   mockRestResponse=sequence[2].response;mockRevision='next-day-change';
   let unsubscribe=()=>{};
   const complete=new Promise<void>(resolve=>{let started=false;unsubscribe=sync.onSyncStatusChange(busy=>{if(busy)started=true;else if(started){unsubscribe();resolve();}});});
   mockCallbacks.revision('next-day-change');await complete;
   expect(history.getLevelSnapshotSync('Example')).toMatchObject({overnightBblsDay:250,levelFeet:9,lastPullDateTimeUTC:sequence[2].response.lastPullDateTimeUTC});
  }finally{sync.stopBackgroundSync();}
 });
});
