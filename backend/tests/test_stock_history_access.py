"""Existing stock-history RLS tested only on the disposable management fixture."""
import json,os
from uuid import uuid4
import psycopg
import pytest
from test_management_postgres import managed,database,native,write
from cacu.accounting.catalog import CatalogMutation
URL=os.getenv('CACU_TEST_DATABASE_URL')
pytestmark=pytest.mark.skipif(not URL,reason='Disposable PostgreSQL required')
def history(d,actor,item):
 with psycopg.connect(URL) as c:
  c.execute('SET LOCAL ROLE authenticated');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(actor)}),))
  return c.execute('SELECT id,delta,before_quantity,after_quantity,entry_date,reason FROM inventory_movements WHERE business_id=%s AND item_id=%s ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET 0',(d[1],item)).fetchall()
def test_history_select_respects_tenant_membership_and_deactivation(managed):
 d=managed;viewer=uuid4()
 item=native(d,CatalogMutation(request_key=uuid4(),operation='item.save',details={'name':'History fixture','opening_quantity':5,'opening_date':f'{d[6]}-02-10'}))
 with psycopg.connect(URL) as c:c.execute("INSERT INTO memberships(business_id,user_id,role) VALUES(%s,%s,'viewer')",(d[1],viewer))
 rows=history(d,viewer,item['id']);assert len(rows)==1 and rows[0][1:4]==(5,0,5)
 assert history(d,uuid4(),item['id'])==[]
 write(d,'member.status',{'is_active':False},viewer,1)
 assert history(d,viewer,item['id'])==[]
 assert len(history(d,d[2],item['id']))==1
