jest.mock('../wellHistory',()=>({getLevelSnapshot:jest.fn(),getPendingPull:jest.fn(),getWellPull:jest.fn(),getSliderPosition:jest.fn()}));
import { getLevelSnapshot, getPendingPull, getWellPull, getSliderPosition } from '../wellHistory';
import { readWellDisplayData } from '../wellDisplayData';
const snapshot=getLevelSnapshot as jest.Mock,pending=getPendingPull as jest.Mock;
beforeEach(()=>{jest.resetAllMocks();(getWellPull as jest.Mock).mockResolvedValue({levelFeet:8});(getSliderPosition as jest.Mock).mockResolvedValue(12);});
test('starts independent reads together but publishes nothing until pending-pull ownership is known',async()=>{
  let releaseSnapshot!:(value:any)=>void,releasePending!:(value:any)=>void;
  snapshot.mockImplementation(()=>new Promise(resolve=>{releaseSnapshot=resolve;}));
  pending.mockImplementation(()=>new Promise(resolve=>{releasePending=resolve;}));
  const config={routeType:'produced-water'} as any;
  const published=jest.fn();const task=readWellDisplayData('A',config).then(published);
  for(const reader of [getLevelSnapshot,getPendingPull,getWellPull,getSliderPosition])expect(reader).toHaveBeenCalled();
  releaseSnapshot({levelFeet:9});await Promise.resolve();expect(published).not.toHaveBeenCalled();
  const drain={wellName:'A',topLevel:10,bblsTaken:40};releasePending(drain);await task;
  expect(published).toHaveBeenCalledWith({snapshot:{levelFeet:9},pending:drain,pull:{levelFeet:8},slider:12});
  expect(snapshot).toHaveBeenCalledWith('A',config);
});
test('a failed preparation rejects instead of publishing an invented zero snapshot',async()=>{
  snapshot.mockResolvedValue({levelFeet:9});pending.mockRejectedValue(new Error('storage unavailable'));
  await expect(readWellDisplayData('A',{} as any)).rejects.toThrow('storage unavailable');
});
