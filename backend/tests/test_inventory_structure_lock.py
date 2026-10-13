"""Historical stock structure guard on a disposable loopback *_test database."""
import os
from pathlib import Path
from uuid import uuid4
import psycopg
import pytest
from sqlalchemy.exc import SQLAlchemyError
from test_management_postgres import managed,database,native,write,read
from cacu.accounting.catalog import CatalogMutation
URL=os.getenv('CACU_TEST_DATABASE_URL')
pytestmark=pytest.mark.skipif(not URL,reason='Disposable PostgreSQL required')
@pytest.fixture
def protected(managed):
 with psycopg.connect(URL) as c:c.execute(Path('../supabase/migrations/20261013073115_inventory_history_structure_lock.sql').read_text(encoding='utf-8'))
 return managed

def exhausted(d):
 item=native(d,CatalogMutation(request_key=uuid4(),operation='item.save',details={'name':'Recorded stock','unit_price':'100','cost_price':'20','opening_quantity':2,'opening_date':f'{d[6]}-02-10'}))
 return native(d,CatalogMutation(request_key=uuid4(),operation='stock.adjust',item_id=item['id'],expected_version=item['version'],details={'delta':-2,'reason':'Damaged','entry_date':f'{d[6]}-02-11'}))

@pytest.mark.parametrize('change',[{'item_type':'SERVICE'},{'unit_of_measure':'pack'},{'track_stock':False}])
def test_zero_stock_with_recorded_history_cannot_change_structure(protected,change):
 d=protected;item=exhausted(d)
 assert item['stock_quantity']==0 and item['structure_locked']
 assert read(d,'catalog')['data'][0]['structure_locked']
 with pytest.raises(psycopg.Error,match='ITEM_STRUCTURE_LOCKED'):write(d,'item.save',change,item['id'],item['version'])
 with psycopg.connect(URL) as c:
  assert c.execute('SELECT item_type,unit_of_measure,track_stock,stock_quantity,version FROM catalog_items WHERE id=%s',(item['id'],)).fetchone()==('PRODUCT','piece',True,0,item['version'])
  assert c.execute('SELECT count(*) FROM inventory_movements').fetchone()[0]==2
  assert c.execute('SELECT count(*) FROM accounting.document_map').fetchone()[0]==2

def test_native_runtime_also_rejects_structure_changes(protected):
 d=protected;item=exhausted(d)
 with pytest.raises(SQLAlchemyError,match='ITEM_STRUCTURE_LOCKED'):native(d,CatalogMutation(request_key=uuid4(),operation='item.save',item_id=item['id'],expected_version=item['version'],details={'unit_of_measure':'kg'}))

def test_history_does_not_block_normal_edits_or_archive(protected):
 d=protected;item=exhausted(d)
 changed=write(d,'item.save',{'name':'Updated','unit_price':'125','is_active':False},item['id'],item['version'])
 assert changed['name']=='Updated' and changed['stock_quantity']==0 and changed['is_active'] is False
 with psycopg.connect(URL) as c:
  assert c.execute('SELECT sum(delta),count(*) FROM inventory_movements').fetchone()==(0,2)
  assert c.execute('SELECT count(*) FROM accounting.document_map').fetchone()[0]==2

def test_unused_items_can_change_stock_unit_and_type(protected):
 d=protected;item=write(d,'item.save',{'name':'Unused'})
 assert item['structure_locked'] is False
 changed=write(d,'item.save',{'unit_of_measure':'pack'},item['id'],item['version'])
 changed=write(d,'item.save',{'item_type':'SERVICE','billing_unit':'hour'},item['id'],changed['version'])
 assert changed['item_type']=='SERVICE' and changed['structure_locked'] is False

def test_migration_preserves_existing_rows_and_private_grants(managed):
 d=managed;item=exhausted(d)
 with psycopg.connect(URL) as c:
  before={table:c.execute('SELECT to_jsonb(t) FROM '+table+' t ORDER BY to_jsonb(t)::text').fetchall() for table in ['catalog_items','inventory_movements','accounting.document_map']}
  c.execute(Path('../supabase/migrations/20261013073115_inventory_history_structure_lock.sql').read_text(encoding='utf-8'))
  after={table:c.execute('SELECT to_jsonb(t) FROM '+table+' t ORDER BY to_jsonb(t)::text').fetchall() for table in before}
  assert after==before
  assert c.execute("SELECT has_function_privilege('authenticated','management_private.item_structure_locked(public.catalog_items)','EXECUTE')").fetchone()[0] is False


def test_quantity_corrections_still_work_after_stock_reaches_zero(protected):
 d=protected;item=exhausted(d)
 corrected=native(d,CatalogMutation(request_key=uuid4(),operation='stock.adjust',item_id=item['id'],expected_version=item['version'],details={'delta':1,'reason':'Recovered item','entry_date':f'{d[6]}-02-12'}))
 assert corrected['stock_quantity']==1 and corrected['structure_locked']
 with psycopg.connect(URL) as c:
  assert c.execute('SELECT sum(delta),count(*) FROM inventory_movements').fetchone()==(1,3)
  assert c.execute('SELECT count(*) FROM accounting.document_map').fetchone()[0]==3
