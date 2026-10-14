-- Align direct attendance access with the existing Owner/Admin HR service boundary.
-- Existing employee salary/bank-data policies already require Owner/Admin.
BEGIN;
CREATE POLICY attendance_owner_admin_boundary ON public.attendance
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.has_business_role(business_id, ARRAY['owner','admin']::public.membership_role[]))
 WITH CHECK (
   public.has_business_role(business_id, ARRAY['owner','admin']::public.membership_role[])
   AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id=employee_id AND e.business_id=attendance.business_id)
 );
COMMIT;
