# Checkout Release QA Notes

## Scope
The checkout release changes coupon validation, payment retries, and order confirmation. The release must preserve existing behavior for guest checkout and signed-in users.

## Acceptance criteria
A valid coupon applies the expected discount once. An expired coupon is rejected with a clear message. A coupon must not be accepted twice when the Apply button is clicked repeatedly. Payment retry must not create duplicate orders. If a payment provider times out, the user can retry and the order remains in a pending state until the provider response is known. Successful checkout shows an order confirmation with order identifier and sends a confirmation email.

## Regression risks
Run browser tests for Chrome and Safari at desktop and mobile widths. Cover guest and authenticated checkout, saved cards, new cards, invalid cards, provider timeout, provider decline, double-click submission, refresh after payment, and network recovery. Validate that the cart total, tax, discount, and final charge remain consistent between UI and API.

## Defect history
DEF-1421: applying a coupon twice caused a duplicate discount in the UI. DEF-1550: a payment retry created two orders when the first provider request succeeded but the response was lost. DEF-1602: the confirmation page showed success before the order status was persisted.

## Release gate
No Sev-1 or Sev-2 checkout defects may remain open. Evidence must include API contract tests, end-to-end payment tests in sandbox mode, database idempotency checks, accessibility checks for error messages, and a smoke-test report with build number and environment.
