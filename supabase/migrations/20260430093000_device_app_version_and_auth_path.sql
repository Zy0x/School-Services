alter table public.devices
add column if not exists app_version text,
add column if not exists release_tag text,
add column if not exists build_commit text,
add column if not exists built_at timestamptz;

update public.app_settings
set value = jsonb_set(
  coalesce(value, '{}'::jsonb),
  '{passwordResetRedirectUrl}',
  to_jsonb('https://school-services.netlify.app/auth/reset-password'::text),
  true
)
where key = 'auth_policy';
