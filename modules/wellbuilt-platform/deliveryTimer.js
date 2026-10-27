const native=require('./index');
let sequence=0;
/** Cancellable deadlines independent of display frames; no payload or network. */
exports.scheduleDeliveryTimer=(fn,delay)=>{
 let cancelled=false,fallback=null;
 const id='delivery-'+Date.now()+'-'+(++sequence);
 const milliseconds=Math.floor(Math.max(0,Math.min(3600000,Number.isFinite(delay)?delay:0)));
 const js=()=>{fallback=setTimeout(()=>{if(!cancelled)fn();},milliseconds);fallback?.unref?.();};
 if(native?.deliveryDelay&&native?.cancelDeliveryDelay){
  try{Promise.resolve(native.deliveryDelay(id,milliseconds)).then(()=>{if(!cancelled)fn();},()=>{if(!cancelled)js();});}
  catch{js();}
 }else js();
 return()=>{cancelled=true;if(fallback!==null)clearTimeout(fallback);try{void Promise.resolve(native?.cancelDeliveryDelay?.(id)).catch(()=>{});}catch{}};
};
