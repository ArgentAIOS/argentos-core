# aos-google-places

`aos-google-places` is an agent-native Google Places connector.

It provides readonly search and place lookup actions backed by the Google Places API.
The connector resolves `GOOGLE_PLACES_API_KEY` from Argent Service Keys first, then
falls back to `process.env`.
