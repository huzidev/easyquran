<script lang="ts">
  import { goto } from "$app/navigation";
  import { createForm, revalidateLogic } from "@tanstack/svelte-form";
  import AuthForm from "$lib/auth/components/AuthForm.svelte";
  import AuthField from "$lib/auth/components/AuthField.svelte";
  import PasswordInput from "$lib/auth/components/PasswordInput.svelte";
  import { createForgotPasswordFlow } from "$lib/auth/flows.svelte";
  import {
    dynamicValidator,
    fieldError,
    ServerFieldErrors,
  } from "$lib/auth/form-validation.svelte";
  import { forgotRequestSchema, forgotVerifySchema, resetPasswordSchema } from "$lib/auth/schemas";

  const flow = createForgotPasswordFlow();

  const requestErrors = new ServerFieldErrors();
  const verifyErrors = new ServerFieldErrors();
  const resetErrors = new ServerFieldErrors();

  const requestForm = createForm(() => ({
    defaultValues: { email: flow.email },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: dynamicValidator(forgotRequestSchema()) },
    onSubmit: async ({ value }) => {
      requestErrors.clearAll();
      flow.email = value.email.trim();
      const ok = await flow.request();
      if (!ok) requestErrors.adopt(flow.fieldErrors);
    },
  }));

  const verifyForm = createForm(() => ({
    defaultValues: { code: flow.code },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: dynamicValidator(forgotVerifySchema()) },
    onSubmit: async ({ value }) => {
      verifyErrors.clearAll();
      flow.code = value.code.trim();
      const ok = await flow.verifyCode();
      if (!ok) verifyErrors.adopt(flow.fieldErrors);
    },
  }));

  const resetForm = createForm(() => ({
    defaultValues: { password: "", confirm_password: "" },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onDynamic: dynamicValidator(resetPasswordSchema()) },
    onSubmit: async ({ value }) => {
      resetErrors.clearAll();
      flow.password = value.password;
      flow.confirmPassword = value.confirm_password;
      const ok = await flow.reset();
      if (!ok) {
        resetErrors.adopt(flow.fieldErrors);
        return;
      }
      await goto("/login");
    },
  }));
</script>

{#if flow.step === "request"}
  <AuthForm
    heading="Reset your password"
    subheading="Enter your account email and we'll send a reset code to it."
    submitLabel="Send reset code"
    pending={flow.pending}
    serverError={flow.genericError}
    successNotice={flow.successMessage}
    onsubmit={() => requestForm.handleSubmit()}
  >
    <requestForm.Field name="email">
      {#snippet children(field)}
        <AuthField
          id="fp-email"
          name={field.name}
          label="Email"
          type="email"
          autocomplete="email"
          value={field.state.value}
          error={fieldError(field.state.meta.errors) ?? requestErrors.current.email ?? null}
          oninput={(next) => {
            requestErrors.clearField(field.name);
            field.handleChange(next);
          }}
          onblur={field.handleBlur}
        />
      {/snippet}
    </requestForm.Field>
    {#snippet footer()}
      <span>Remembered it? <a href="/login" class="text-accent hover:underline">Back to sign in</a></span>
    {/snippet}
  </AuthForm>
{:else if flow.step === "verify"}
  <AuthForm
    heading="Enter your reset code"
    subheading="We sent a 6-digit code to your email."
    submitLabel="Verify code"
    pending={flow.pending}
    serverError={flow.genericError}
    onsubmit={() => verifyForm.handleSubmit()}
  >
    <verifyForm.Field name="code">
      {#snippet children(field)}
        <AuthField
          id="fp-code"
          name={field.name}
          label="Reset code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength={6}
          value={field.state.value}
          error={fieldError(field.state.meta.errors) ?? verifyErrors.current.code ?? null}
          oninput={(next) => {
            verifyErrors.clearField(field.name);
            field.handleChange(next);
          }}
          onblur={field.handleBlur}
        />
      {/snippet}
    </verifyForm.Field>
  </AuthForm>
{:else if flow.step === "reset"}
  <AuthForm
    heading="Set a new password"
    subheading="Choose a strong password of at least 12 characters."
    submitLabel="Reset password"
    pending={flow.pending}
    serverError={flow.genericError}
    onsubmit={() => resetForm.handleSubmit()}
  >
    <resetForm.Field name="password">
      {#snippet children(field)}
        <PasswordInput
          id="fp-password"
          name={field.name}
          label="New password"
          autocomplete="new-password"
          minlength={12}
          value={field.state.value}
          error={fieldError(field.state.meta.errors) ?? resetErrors.current.password ?? null}
          oninput={(next) => {
            resetErrors.clearField(field.name);
            field.handleChange(next);
          }}
          onblur={field.handleBlur}
        />
      {/snippet}
    </resetForm.Field>
    <resetForm.Field name="confirm_password">
      {#snippet children(field)}
        <PasswordInput
          id="fp-confirm"
          name={field.name}
          label="Confirm new password"
          autocomplete="new-password"
          minlength={12}
          value={field.state.value}
          error={fieldError(field.state.meta.errors) ??
            resetErrors.current.confirm_password ??
            null}
          oninput={(next) => {
            resetErrors.clearField(field.name);
            field.handleChange(next);
          }}
          onblur={field.handleBlur}
        />
      {/snippet}
    </resetForm.Field>
  </AuthForm>
{:else}
  <AuthForm
    heading="Password reset"
    subheading="Your password has been reset. You can sign in with your new password now."
    submitLabel="Back to sign in"
    onsubmit={async () => {
      await goto("/login");
    }}
  />
{/if}
