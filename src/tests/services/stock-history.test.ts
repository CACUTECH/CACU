import {InventoryService} from '@/services/inventory-service';
jest.mock('@/lib/accounting-client',()=>({usesPythonAccounting:jest.fn()}));
const item='11111111-1111-4111-8111-111111111111';
const scope='22222222-2222-4222-8222-222222222222';
function setup(itemData:unknown={id:item}){
 const catalog={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),single:jest.fn().mockResolvedValue({data:itemData,error:null})};
 const movements={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),range:jest.fn().mockResolvedValue({data:[{id:'movement',delta:2}],count:21,error:null})};
 const client={from:jest.fn().mockReturnValueOnce(catalog).mockReturnValueOnce(movements)};
 const service=new InventoryService();(service as unknown as {getContext:jest.Mock}).getContext=jest.fn().mockResolvedValue({supabase:client,businessId:scope});
 return {service,catalog,movements,client};
}
test('history checks item ownership and scopes both reads to the selected business',async()=>{const {service,catalog,movements}=setup();expect((await service.adjustmentHistory(item,1)).total).toBe(21);expect(catalog.eq).toHaveBeenCalledWith('business_id',scope);expect(catalog.eq).toHaveBeenCalledWith('id',item);expect(movements.eq).toHaveBeenCalledWith('business_id',scope);expect(movements.eq).toHaveBeenCalledWith('item_id',item);expect(movements.range).toHaveBeenCalledWith(20,39);expect(movements.order).toHaveBeenCalledWith('id',{ascending:false});});
test('foreign or missing items do not query movements',async()=>{const {service,client}=setup(null);await expect(service.adjustmentHistory(item)).rejects.toThrow('Item unavailable');expect(client.from).toHaveBeenCalledTimes(1);});
test.each([-1,1.2,NaN,Infinity,100001])('invalid page %s cannot query data',async(page)=>{const {service,client}=setup();await expect(service.adjustmentHistory(item,page)).rejects.toThrow('Invalid history request');expect(client.from).not.toHaveBeenCalled();});
test('invalid IDs cannot query data',async()=>{const {service,client}=setup();await expect(service.adjustmentHistory('other-business')).rejects.toThrow('Invalid history request');expect(client.from).not.toHaveBeenCalled();});
test('history failures do not return partial results',async()=>{const {service,movements}=setup();movements.range.mockResolvedValue({data:null,error:{message:'private failure'},count:null});await expect(service.adjustmentHistory(item)).rejects.toThrow('could not be loaded');});
