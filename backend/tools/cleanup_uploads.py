"""Scheduled trusted operator task: only expired managed uploads, never legacy files or files with valid resources."""
import argparse
from cacu.uploads.service import UploadGateway, cleanup

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--apply',action='store_true',help='Claim and remove expired unfinished uploads (maximum 100)')
    args=parser.parse_args()
    if not args.apply:
        print('No changes. Use --apply to clean expired unfinished uploads.'); return
    gateway=UploadGateway('')
    try:
        rows=gateway.rpc('claim_upload_orphans',privileged=True)
        complete=sum(cleanup(gateway,row,'deleted') for row in rows)
        print(f'Claimed {len(rows)} expired uploads; removed {complete}; retry failures next run.')
    finally: gateway.close()
if __name__=='__main__': main()
