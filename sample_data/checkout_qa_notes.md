# Checkout Release QA Notes

## Scope
The checkout release changes coupon validation, payment retries, and order confirmation. The release must preserve existing behavior for guest checkout and signed-in users.

## Acceptance Criteria
- A valid coupon applies the expected discount exactly once.
- An expired coupon is rejected with a clear user-facing error message.
- A coupon must not be accepted twice when the Apply button is clicked rapidly (idempotency).
- Payment retry must not create duplicate orders under any network condition.
- If a payment provider times out, the user can retry and the order remains in a pending state until the provider response is confirmed.
- Successful checkout displays an order confirmation page with order identifier and sends a confirmation email within 60 seconds.
- Cart total, tax, discount, and final charge must be consistent between the UI and the API response.

## Regression Test Areas

### Coupon Validation
- Apply a valid coupon: verify discount amount matches expected value.
- Apply an expired coupon: verify rejection message is shown and no discount is applied.
- Apply a coupon twice in rapid succession: verify only one discount is applied (covers DEF-1421).
- Apply a coupon then remove it: verify cart total reverts correctly.
- Apply a coupon with a minimum order value: verify it is rejected below threshold.

### Payment Flow
- Complete payment with a saved card: verify order is created once.
- Complete payment with a new card: verify card is saved if user opts in.
- Submit with an invalid card number: verify inline validation error.
- Simulate provider timeout: verify order stays in pending state and retry is offered.
- Simulate provider decline: verify user sees decline message and can re-enter card.
- Double-click the Pay button: verify only one order is created (covers DEF-1550).
- Refresh the page after payment submission: verify order state is not duplicated.
- Network drop mid-payment: verify recovery flow and no duplicate charge.

### Order Confirmation
- Verify confirmation page shows correct order ID immediately after payment (covers DEF-1602).
- Verify confirmation email is received within 60 seconds.
- Verify order appears in order history for signed-in users.
- Verify guest checkout confirmation does not require login.

### Cross-Browser and Responsive
- Run all critical paths in Chrome and Safari at desktop width (1280px).
- Run all critical paths in Chrome and Safari at mobile width (375px).
- Verify coupon input and Pay button are accessible via keyboard navigation.
- Verify error messages meet WCAG 2.1 AA contrast requirements.

### Guest vs Authenticated
- Complete full checkout as a guest user.
- Complete full checkout as a signed-in user with a saved address and saved card.
- Verify session does not leak between guest and authenticated flows.

## Defect History

**DEF-1421** (Severity 2 — Closed): Applying a coupon twice caused a duplicate discount in the UI. Root cause: the Apply button was not disabled after first application. Fix: button is disabled after successful coupon application. Regression test: apply coupon twice rapidly and verify cart total.

**DEF-1550** (Severity 1 — Closed): A payment retry created two orders when the first provider request succeeded but the response was lost in transit. Root cause: missing idempotency key on the payment API call. Fix: idempotency key derived from cart ID and session. Regression test: simulate provider timeout and verify only one order exists in the database.

**DEF-1602** (Severity 2 — Closed): The confirmation page showed success before the order status was persisted to the database. Root cause: frontend navigated on HTTP 200 from payment provider before backend write completed. Fix: backend now returns order ID only after database commit. Regression test: verify order ID on confirmation page matches database record immediately.

**DEF-1588** (Severity 3 — Closed): Tax calculation was incorrect for orders shipping to certain states when a coupon was applied. Root cause: discount was subtracted before tax base was calculated. Fix: tax is now calculated on pre-discount subtotal per tax rules. Regression test: apply coupon to order shipping to affected states and verify tax amount.

**DEF-1611** (Severity 2 — Open): Confirmation email is not sent when the email service is temporarily unavailable. The order is created but the user receives no notification. Workaround: manual resend via admin panel. This defect must be resolved or have an accepted risk sign-off before release.

## Release Gate Criteria
- No Sev-1 or Sev-2 checkout defects may remain open at release. DEF-1611 must be resolved or have explicit risk acceptance from the product owner.
- Required evidence artifacts:
  - API contract test results (all endpoints passing).
  - End-to-end payment tests executed in sandbox mode with pass/fail counts.
  - Database idempotency check results for duplicate-order scenarios.
  - Accessibility audit report for checkout error messages.
  - Smoke-test report including build number, environment name, and execution timestamp.
  - Cross-browser test results for Chrome and Safari on desktop and mobile.
- Performance: checkout page load must be under 2 seconds at P95 in the staging environment.
- Security: no new high or critical findings from the DAST scan on the payment endpoints.

## Test Data Requirements
- At least three valid coupon codes covering: percentage discount, fixed amount discount, and free shipping.
- At least two expired coupon codes.
- Sandbox payment cards: valid Visa, valid Mastercard, declined card, card that triggers timeout.
- Test accounts: one guest session, one signed-in user with saved address and saved card.
- Orders must be placed in the staging environment connected to the payment sandbox, not production.

## Environment and Dependency Notes
- Staging environment must be on the same release branch as the build under test.
- Payment provider sandbox must be configured with the test merchant credentials, not production keys.
- Email service must be pointed at the test inbox, not production SMTP.
- Feature flag `checkout_v2_coupon` must be enabled in staging for coupon validation tests.
- Feature flag `payment_retry_idempotency` must be enabled; this flag gates the DEF-1550 fix.
