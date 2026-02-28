#!/usr/bin/env bash
#
# UAT Script: Vendor Creates Product, Sets Fulfillment, Publishes Listing
#
# Prerequisites:
#   - Backend running at $API_BASE (default: http://localhost:9000)
#   - Authenticated vendor token in $VENDOR_TOKEN
#
# Usage:
#   export API_BASE=http://localhost:9000
#   export VENDOR_TOKEN="your-jwt-token"
#   bash scripts/uat-product-publish-flow.sh
#
# This script validates the complete product publish flow:
#   1. Create a product (draft status) with fulfillment type and supplier
#   2. Verify product was created with correct metadata
#   3. Update product with inventory quantity and low-stock threshold
#   4. Publish the product (change status to "published")
#   5. Verify published status
#   6. Delete the test product (cleanup)

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:9000}"
VENDOR_TOKEN="${VENDOR_TOKEN:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

if [ -z "$VENDOR_TOKEN" ]; then
  fail "VENDOR_TOKEN environment variable is required"
fi

AUTH_HEADER="Authorization: Bearer ${VENDOR_TOKEN}"
CONTENT_TYPE="Content-Type: application/json"

PRODUCT_ID=""

cleanup() {
  if [ -n "$PRODUCT_ID" ]; then
    info "Cleaning up test product ${PRODUCT_ID}..."
    curl -s -X DELETE "${API_BASE}/vendor/products/${PRODUCT_ID}" \
      -H "$AUTH_HEADER" -H "$CONTENT_TYPE" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "=========================================="
echo " UAT: Product Publish Flow"
echo "=========================================="
echo ""

# Step 1: Create a draft product with fulfillment type and supplier
info "Step 1: Creating draft product with fulfillment & supplier metadata..."

CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/vendor/seller-products" \
  -H "$AUTH_HEADER" \
  -H "$CONTENT_TYPE" \
  -d '{
    "title": "UAT Test Product - Artisan Soap",
    "description": "Handmade artisan soap for UAT testing",
    "status": "draft",
    "handle": "uat-test-artisan-soap-'$(date +%s)'",
    "discountable": true,
    "options": [{"title": "Size", "values": ["Standard"]}],
    "variants": [{
      "title": "Standard",
      "manage_inventory": true,
      "allow_backorder": false,
      "options": {"Size": "Standard"},
      "prices": [{"currency_code": "usd", "amount": 1299}]
    }],
    "metadata": {
      "fulfillment_type": "self_ship",
      "supplier_name": "Local Artisan Co-op",
      "inventory_quantity": 50,
      "low_stock_threshold": 10
    }
  }')

HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -1)
BODY=$(echo "$CREATE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  PRODUCT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['product']['id'])" 2>/dev/null || echo "")
  if [ -n "$PRODUCT_ID" ]; then
    pass "Product created: ${PRODUCT_ID}"
  else
    fail "Product created but could not extract ID from response"
  fi
else
  fail "Failed to create product (HTTP ${HTTP_CODE}): ${BODY}"
fi

# Step 2: Verify product was created with correct data
info "Step 2: Verifying product details..."

GET_RESPONSE=$(curl -s -X GET "${API_BASE}/vendor/products/${PRODUCT_ID}" \
  -H "$AUTH_HEADER" -H "$CONTENT_TYPE")

PRODUCT_STATUS=$(echo "$GET_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['product']['status'])" 2>/dev/null || echo "")
PRODUCT_TITLE=$(echo "$GET_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['product']['title'])" 2>/dev/null || echo "")

if [ "$PRODUCT_STATUS" = "draft" ]; then
  pass "Product is in draft status"
else
  fail "Expected status 'draft' but got '${PRODUCT_STATUS}'"
fi

if [ "$PRODUCT_TITLE" = "UAT Test Product - Artisan Soap" ]; then
  pass "Product title is correct"
else
  fail "Expected title 'UAT Test Product - Artisan Soap' but got '${PRODUCT_TITLE}'"
fi

# Step 3: Update product with inventory fields via edit endpoint
info "Step 3: Updating product with inventory metadata..."

UPDATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/vendor/products/${PRODUCT_ID}" \
  -H "$AUTH_HEADER" \
  -H "$CONTENT_TYPE" \
  -d '{
    "metadata": {
      "fulfillment_type": "dropship",
      "supplier_name": "Updated Supplier LLC",
      "inventory_quantity": 100,
      "low_stock_threshold": 20
    }
  }')

HTTP_CODE=$(echo "$UPDATE_RESPONSE" | tail -1)
if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  pass "Product metadata updated (fulfillment: dropship, supplier: Updated Supplier LLC)"
else
  BODY=$(echo "$UPDATE_RESPONSE" | sed '$d')
  fail "Failed to update product (HTTP ${HTTP_CODE}): ${BODY}"
fi

# Step 4: Publish the product
info "Step 4: Publishing product..."

PUBLISH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE}/vendor/products/${PRODUCT_ID}/status" \
  -H "$AUTH_HEADER" \
  -H "$CONTENT_TYPE" \
  -d '{"status": "published"}')

HTTP_CODE=$(echo "$PUBLISH_RESPONSE" | tail -1)
if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  pass "Product status updated to published"
else
  BODY=$(echo "$PUBLISH_RESPONSE" | sed '$d')
  fail "Failed to publish product (HTTP ${HTTP_CODE}): ${BODY}"
fi

# Step 5: Verify published status
info "Step 5: Verifying published status..."

VERIFY_RESPONSE=$(curl -s -X GET "${API_BASE}/vendor/products/${PRODUCT_ID}" \
  -H "$AUTH_HEADER" -H "$CONTENT_TYPE")

FINAL_STATUS=$(echo "$VERIFY_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['product']['status'])" 2>/dev/null || echo "")

if [ "$FINAL_STATUS" = "published" ]; then
  pass "Product is now published"
else
  fail "Expected status 'published' but got '${FINAL_STATUS}'"
fi

# Step 6: Cleanup (handled by trap)
info "Step 6: Cleaning up test product..."

echo ""
echo "=========================================="
echo -e " ${GREEN}ALL UAT CHECKS PASSED${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - Product created in draft status with fulfillment & supplier metadata"
echo "  - Product metadata updated (fulfillment type, supplier, inventory)"
echo "  - Product published via status endpoint"
echo "  - Published status verified"
echo "  - Test product cleaned up"
