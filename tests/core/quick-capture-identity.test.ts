import {afterEach,expect,it,vi} from "vitest";
import {executeQuickCaptureSave} from "@/core/quick-capture-saver";
import {setTransport,type DetachedRowIdentity} from "@/core/siyuan";
afterEach(()=>{setTransport(null);vi.restoreAllMocks()});
const identity=():DetachedRowIdentity=>({avID:"av",desiredItemID:"20261109000000-target1",before:["old-row"],submitted:true});
const options=(rowIdentity?:DetachedRowIdentity)=>({plugin:{settings:{members:[]}},moduleId:"certs",values:{name:"护照",expiry:"2035-12-31"},captureFields:[{key:"name",type:"text" as const},{key:"expiry",type:"date" as const}],hadIdentityPending:true,saveOperationKey:"original-op",rowIdentity,t:(k:string)=>k,fieldLabel:(f:any)=>f.key,modLabel:(m:string)=>m,ensureTargetRef:async()=>({avId:"av",columns:{name:"name",expiry:"expiry"}})});
it("unknown quick-capture never adopts same-name old/new candidates and never resends add",async()=>{
    let adds=0,writes=0;
    setTransport(async endpoint=>{if(endpoint==='/api/av/addAttributeViewBlocks')adds++;if(endpoint==='/api/av/setAttributeViewBlockAttr')writes++;return {code:0,msg:'',data:{view:{rows:[{id:'old-row',cells:[]},{id:'other-new',cells:[]}]}}}});
    const result=await executeQuickCaptureSave(options(identity()));
    expect(result.identityPending).toBe(true);expect(adds).toBe(0);expect(writes).toBe(0);
});
it("unknown quick-capture read failure and missing witness stop with zero add/cell writes",async()=>{
    let adds=0;
    setTransport(async endpoint=>{if(endpoint==='/api/av/addAttributeViewBlocks')adds++;throw TypeError('offline')});
    expect((await executeQuickCaptureSave(options(identity()))).identityPending).toBe(true);
    expect((await executeQuickCaptureSave(options())).identityPending).toBe(true);expect(adds).toBe(0);
});
it("recovered original ID is the only write target and keeps operation key",async()=>{
    const target=identity(), writes:any[]=[];
    setTransport(async(endpoint,payload:any)=>{if(endpoint==='/api/av/setAttributeViewBlockAttr')writes.push(payload);return {code:0,msg:'',data:{view:{rows:[{id:'old-row'},{id:target.desiredItemID}]}}}});
    const result=await executeQuickCaptureSave(options(target));expect(result.success).toBe(true);
    expect(writes.length).toBe(2);expect(writes.every(p=>p.itemID===target.desiredItemID)).toBe(true);expect(target.submitted).toBe(true);
});
