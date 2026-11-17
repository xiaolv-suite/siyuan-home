import {afterEach, describe, expect, it, vi} from "vitest";
import {addDetachedRow, RowIdentityPendingError, setTransport, type DetachedRowIdentity} from "@/core/siyuan";
import {executeLedgerRecordSave} from "@/core/ledger-record-saver";
import * as siyuan from "@/core/siyuan";
afterEach(()=>{setTransport(null);vi.restoreAllMocks();});
const witness = (): DetachedRowIdentity => ({avID:'av',desiredItemID:'20261109000000-target1',before:['old-row'],submitted:true});
describe('unknown ledger row identity',()=>{
    it('an explicit unique add response safely records the kernel-allocated ID',async()=>{
        const identity:DetachedRowIdentity={avID:'av',desiredItemID:'',before:[],submitted:false};
        setTransport(async endpoint=>endpoint==='/api/av/addAttributeViewBlocks'
            ? {code:0,msg:'',data:{rowID:'kernel-created-row'}}
            : {code:0,msg:'',data:{view:{rows:[{id:'old-row'}]}}});
        expect(await addDetachedRow('av','护照',{rowIdentity:identity})).toBe('kernel-created-row');
        expect(identity.desiredItemID).toBe('kernel-created-row');expect(identity.before).toEqual(['old-row']);
    });
    it('record retry writes only the witnessed row, never an old same-name row',async()=>{
        const writes:any[]=[];let adds=0;
        const identity=witness();
        setTransport(async(endpoint,payload:any)=>{
            if(endpoint==='/api/av/renderAttributeView')return {code:0,msg:'',data:{view:{rows:[{id:'old-row'},{id:identity.desiredItemID}]}}};
            if(endpoint==='/api/av/addAttributeViewBlocks')adds++;
            if(endpoint==='/api/av/setAttributeViewBlockAttr')writes.push(payload);
            return {code:0,msg:'',data:{}};
        });
        const result=await executeLedgerRecordSave({plugin:{settings:{dbRefs:{certs:{columns:{name:'name',expiry:'expiry'}}}}},active:'certs',ref:{avId:'av'},form:{name:'护照',expiry:'2031-12-31'},supportableCols:[{key:'name',type:'text'},{key:'expiry',type:'date'}],hadIdentityPending:true,rowIdentity:identity,recordOperationKey:'original-op',t:k=>k});
        expect(result.itemID).toBe(identity.desiredItemID);expect(result.recordOperationKey).toBe('original-op');expect(adds).toBe(0);
        expect(writes.length).toBe(2);expect(writes.every(p=>p.itemID===identity.desiredItemID)).toBe(true);
    });
    it('retries reconcile only exact original ID, never send another add or adopt another row',async()=>{
        const trace:string[]=[];let ids=['old-row','unrelated-new'];
        setTransport(async endpoint=>{trace.push(endpoint);return {code:0,msg:'',data:{view:{rows:ids.map(id=>({id}))}}}});
        const identity=witness();
        await expect(addDetachedRow('av','护照',{rowIdentity:identity})).rejects.toBeInstanceOf(RowIdentityPendingError);
        ids.push(identity.desiredItemID);
        expect(await addDetachedRow('av','护照',{rowIdentity:identity})).toBe(identity.desiredItemID);
        expect(trace.every(e=>e==='/api/av/renderAttributeView')).toBe(true);
    });
    it('read failure and legacy missing witness stop with no cell writes or new row',async()=>{
        const add=vi.spyOn(siyuan,'addDetachedRow');const write=vi.spyOn(siyuan,'setCell');
        await expect(executeLedgerRecordSave({plugin:{},active:'certs',ref:{avId:'av',columns:{name:'name'}},form:{name:'护照'},supportableCols:[],hadIdentityPending:true,t:k=>k})).rejects.toBeInstanceOf(RowIdentityPendingError);
        expect(add).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
        setTransport(async()=>{throw Error('disk unavailable')});
        await expect(addDetachedRow('av','护照',{rowIdentity:witness(),retries:0})).rejects.toBeInstanceOf(RowIdentityPendingError);
    });
    it('first submission retains desired identity and before set across unknown result',async()=>{
        const identity:DetachedRowIdentity={avID:'av',desiredItemID:'',before:[],submitted:false};
        let creates=0;
        setTransport(async endpoint=>{
            if(endpoint==='/api/av/addAttributeViewBlocks'){creates++;throw TypeError('lost response')}
            return {code:0,msg:'',data:{view:{rows:[{id:'old-row'},{id:'unrelated-new'}]}}};
        });
        await expect(addDetachedRow('av','护照',{rowIdentity:identity,retries:0})).rejects.toBeInstanceOf(RowIdentityPendingError);
        expect(identity.submitted).toBe(true);expect(identity.desiredItemID).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        await expect(addDetachedRow('av','改名草稿',{rowIdentity:identity,retries:0})).rejects.toBeInstanceOf(RowIdentityPendingError);
        expect(creates).toBe(1);
    });
});
