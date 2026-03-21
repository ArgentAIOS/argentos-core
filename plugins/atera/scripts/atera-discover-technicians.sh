#!/bin/bash
# Atera Technician ID Discovery Script
# Mines all tickets to extract technician ID → name mappings
# Required because Atera has no /technicians endpoint (yes, really)

set -e

API_KEY="${ATERA_API_KEY}"
BASE_URL="https://app.atera.com/api/v3"
OUTPUT_FILE="/Users/sem/argent/docs/atera-technician-ids.json"

if [ -z "$API_KEY" ]; then
  echo "Error: ATERA_API_KEY not set"
  exit 1
fi

echo "🔍 Discovering technician IDs from ticket assignments..."

# Temporary file for discovered technicians
TEMP_FILE=$(mktemp)

# Get total pages first
FIRST_PAGE=$(curl -s -X GET \
  "${BASE_URL}/tickets?itemsInPage=50&page=1" \
  -H "Accept: application/json" \
  -H "X-API-KEY: ${API_KEY}")

TOTAL_PAGES=$(echo "$FIRST_PAGE" | jq -r '.totalPages // 1')
echo "📄 Found ${TOTAL_PAGES} pages of tickets to process..."

# Loop through all pages
for ((page=1; page<=TOTAL_PAGES; page++)); do
  echo "   Processing page ${page}/${TOTAL_PAGES}..."
  
  RESPONSE=$(curl -s -X GET \
    "${BASE_URL}/tickets?itemsInPage=50&page=${page}" \
    -H "Accept: application/json" \
    -H "X-API-KEY: ${API_KEY}")
  
  # Extract technician assignments (TechnicianContactID)
  echo "$RESPONSE" | jq -r '.items[] | 
    select(.TechnicianContactID != null and .TechnicianContactID > 0) | 
    {id: .TechnicianContactID, name: "\(.TechnicianFirstName) \(.TechnicianLastName)"}' >> "$TEMP_FILE"
  
  # Extract resolved technicians
  echo "$RESPONSE" | jq -r '.items[] | 
    select(.TicketResolvedTechnicianContactId != null and .TicketResolvedTechnicianContactId > 0) | 
    {id: .TicketResolvedTechnicianContactId, name: "\(.TechnicianFirstName) \(.TechnicianLastName)"}' >> "$TEMP_FILE"
done

echo ""
echo "🧮 Deduplicating technician records..."

# Deduplicate using jq (combine all JSON objects into array, unique by id)
TECH_ARRAY=$(cat "$TEMP_FILE" | jq -s 'unique_by(.id) | sort_by(.id)')

# Write final JSON
jq -n \
  --argjson techs "$TECH_ARRAY" \
  --arg updated "$(date -u +"%Y-%m-%dT%H:%M:%S%z")" \
  '{
    technicians: $techs,
    last_updated: $updated,
    discovery_method: "ticket_assignment_mining",
    total_found: ($techs | length)
  }' > "$OUTPUT_FILE"

# Cleanup
rm "$TEMP_FILE"

# Display results
echo ""
echo "✅ Discovery complete!"
echo ""
cat "$OUTPUT_FILE" | jq '.'
echo ""
echo "📍 Saved to: ${OUTPUT_FILE}"
echo "👥 Found $(jq '.total_found' "$OUTPUT_FILE") active technicians"
