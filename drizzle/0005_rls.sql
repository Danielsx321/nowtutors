-- Custom migration: Row Level Security per SPEC §5. Model: broad table GRANTs to
-- anon/authenticated, then RLS scopes rows. service_role has BYPASSRLS, so
-- "service role only" tables simply get an owner SELECT policy and no write policy.
-- is_admin() is defined in 0003.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
--> statement-breakpoint
-- service_role has BYPASSRLS but still needs table privileges. Granted
-- explicitly so migrations are self-sufficient even on a reset public schema.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
--> statement-breakpoint
-- Sensitive/service-role columns on tutor_profiles: approval fields are writable
-- only by the service role (admin approval runs server-side). SPEC §5.
REVOKE UPDATE ("approval_status", "approval_note", "approved_at")
  ON public.tutor_profiles FROM anon, authenticated;
--> statement-breakpoint

-- Enable RLS on every table.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tutor_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tutor_payout_details ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tutor_subjects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.session_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tutor_earnings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.broadcast_viewers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- profiles: own row (admins read all). Other users' safe columns via public_profiles.
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());
--> statement-breakpoint
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
--> statement-breakpoint

-- tutor_profiles: anyone reads approved; owner reads/writes own; approval columns revoked above.
CREATE POLICY "tutor_profiles_select" ON public.tutor_profiles FOR SELECT TO anon, authenticated
  USING (approval_status = 'approved' OR user_id = auth.uid() OR public.is_admin());
--> statement-breakpoint
CREATE POLICY "tutor_profiles_insert" ON public.tutor_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "tutor_profiles_update" ON public.tutor_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

-- tutor_payout_details: owner + admin only (Decision A).
CREATE POLICY "payout_select" ON public.tutor_payout_details FOR SELECT TO authenticated
  USING (tutor_id = auth.uid() OR public.is_admin());
--> statement-breakpoint
CREATE POLICY "payout_insert" ON public.tutor_payout_details FOR INSERT TO authenticated
  WITH CHECK (tutor_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "payout_update" ON public.tutor_payout_details FOR UPDATE TO authenticated
  USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());
--> statement-breakpoint

-- subjects: public read; admin writes.
CREATE POLICY "subjects_select" ON public.subjects FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "subjects_admin_write" ON public.subjects FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- tutor_subjects: public read; owning tutor writes.
CREATE POLICY "tutor_subjects_select" ON public.tutor_subjects FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "tutor_subjects_write" ON public.tutor_subjects FOR ALL TO authenticated
  USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());
--> statement-breakpoint

-- availability: public read (students compute slots); owning tutor writes.
CREATE POLICY "availability_rules_select" ON public.availability_rules FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "availability_rules_write" ON public.availability_rules FOR ALL TO authenticated
  USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "availability_exceptions_select" ON public.availability_exceptions FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "availability_exceptions_write" ON public.availability_exceptions FOR ALL TO authenticated
  USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());
--> statement-breakpoint

-- bookings: participants only. Status-transition rules enforced in the app layer (§7).
CREATE POLICY "bookings_select" ON public.bookings FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR tutor_id = auth.uid() OR public.is_admin());
--> statement-breakpoint
CREATE POLICY "bookings_insert" ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "bookings_update" ON public.bookings FOR UPDATE TO authenticated
  USING (student_id = auth.uid() OR tutor_id = auth.uid())
  WITH CHECK (student_id = auth.uid() OR tutor_id = auth.uid());
--> statement-breakpoint

-- session_requests: participants; student inserts; either participant updates status.
CREATE POLICY "session_requests_select" ON public.session_requests FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR tutor_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "session_requests_insert" ON public.session_requests FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "session_requests_update" ON public.session_requests FOR UPDATE TO authenticated
  USING (student_id = auth.uid() OR tutor_id = auth.uid())
  WITH CHECK (student_id = auth.uid() OR tutor_id = auth.uid());
--> statement-breakpoint

-- wallets / credit_transactions / payments / tutor_earnings: owner reads; writes service-role only.
CREATE POLICY "wallets_select" ON public.wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "credit_tx_select" ON public.credit_transactions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "payments_select" ON public.payments FOR SELECT TO authenticated
  USING (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "tutor_earnings_select" ON public.tutor_earnings FOR SELECT TO authenticated
  USING (tutor_id = auth.uid());
--> statement-breakpoint

-- withdrawal_requests: owner + admin read; tutor inserts; admin transitions status.
CREATE POLICY "withdrawals_select" ON public.withdrawal_requests FOR SELECT TO authenticated
  USING (tutor_id = auth.uid() OR public.is_admin());
--> statement-breakpoint
CREATE POLICY "withdrawals_insert" ON public.withdrawal_requests FOR INSERT TO authenticated
  WITH CHECK (tutor_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "withdrawals_admin_update" ON public.withdrawal_requests FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- conversations / messages: participant-scoped.
CREATE POLICY "conversations_select" ON public.conversations FOR SELECT TO authenticated
  USING (participant_a = auth.uid() OR participant_b = auth.uid());
--> statement-breakpoint
CREATE POLICY "conversations_insert" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (participant_a = auth.uid() OR participant_b = auth.uid());
--> statement-breakpoint
CREATE POLICY "conversations_update" ON public.conversations FOR UPDATE TO authenticated
  USING (participant_a = auth.uid() OR participant_b = auth.uid())
  WITH CHECK (participant_a = auth.uid() OR participant_b = auth.uid());
--> statement-breakpoint
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
  ));
--> statement-breakpoint
CREATE POLICY "messages_insert" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
    )
  );
--> statement-breakpoint
CREATE POLICY "messages_update" ON public.messages FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
      AND (c.participant_a = auth.uid() OR c.participant_b = auth.uid())
  ));
--> statement-breakpoint

-- notifications: owner reads and marks read; inserts service-role only.
CREATE POLICY "notifications_select" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
--> statement-breakpoint
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

-- broadcasts: public read; owning tutor writes.
CREATE POLICY "broadcasts_select" ON public.broadcasts FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "broadcasts_write" ON public.broadcasts FOR ALL TO authenticated
  USING (tutor_id = auth.uid()) WITH CHECK (tutor_id = auth.uid());
--> statement-breakpoint

-- broadcast_viewers: a viewer sees own rows; the host sees their broadcast's viewers.
CREATE POLICY "broadcast_viewers_select" ON public.broadcast_viewers FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.broadcasts b
      WHERE b.id = broadcast_id AND b.tutor_id = auth.uid()
    )
  );
--> statement-breakpoint
CREATE POLICY "broadcast_viewers_insert" ON public.broadcast_viewers FOR INSERT TO anon, authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
--> statement-breakpoint
CREATE POLICY "broadcast_viewers_update" ON public.broadcast_viewers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
--> statement-breakpoint

-- platform_settings: anyone reads (pricing display); admin writes.
CREATE POLICY "platform_settings_select" ON public.platform_settings FOR SELECT TO anon, authenticated
  USING (true);
--> statement-breakpoint
CREATE POLICY "platform_settings_admin_write" ON public.platform_settings FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
--> statement-breakpoint

-- audit_log: admin reads; writes service-role only.
CREATE POLICY "audit_log_select" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_admin());
