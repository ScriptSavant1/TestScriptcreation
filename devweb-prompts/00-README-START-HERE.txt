================================================================================
  POSTMAN/BRUNO TO VUGEN DEVWEB SCRIPT CONVERTER - PURE PROMPT SYSTEM
================================================================================

  NO CODE NEEDED. NO PROJECT SETUP. JUST PROMPTS + AI.

  Created by: API Testing Team
  Compatible with: GitLab Duo, GitHub Copilot, Claude, ChatGPT, or any AI agent

================================================================================
  HOW TO USE THIS SYSTEM
================================================================================

  STEP 1: Export your Postman collection (v2.1 JSON) or Bruno collection (JSON)

  STEP 2: Open your AI coding assistant (GitLab Duo / Copilot / Claude / etc.)

  STEP 3: Upload/paste these files to the AI in this order:

     a) "01-MASTER-PROMPT.txt"           -- The main orchestrator (ALWAYS first)
     b) Your collection JSON file        -- The Postman/Bruno collection to convert
     c) (Optional) Environment JSON      -- If you have environment variables

  STEP 4: The AI will generate a complete DevWeb script folder with:
     - main.js              (the load test script)
     - scenario.yml         (scenario config with pacing, vusers, duration)
     - rts.yml              (runtime settings)
     - tsconfig.json        (TypeScript config)
     - parameters.yml       (when collection has variables)
     - collection_data.csv  (actual variable values from collection/environment)
     - data/*.b64           (extracted large base64 values, if any)

  STEP 5: Copy the generated files into your VuGen DevWeb project folder.
          Done!

================================================================================
  PROMPT FILES INCLUDED
================================================================================

  00-README-START-HERE.txt        -- This file (instructions)
  01-MASTER-PROMPT.txt            -- Main prompt with variable classification + correlation algorithm
  02-MAIN-JS-GENERATOR.txt        -- Detailed main.js rules, URL handling, validation patterns
  03-AUTHENTICATION-HANDLER.txt   -- All auth types (OAuth2, Basic, Bearer, AWS, Digest, NTLM)
  04-CORRELATION-EXTRACTOR.txt    -- 2-pass correlation algorithm + inference rules
  05-SCENARIO-YML-GENERATOR.txt   -- scenario.yml generation rules
  06-MANDATORY-FILES.txt          -- tsconfig.json, rts.yml, DevWebSdk.d.ts templates
  07-PARAMETERS-YML-RULES.txt     -- CRITICAL: 3 types of values (static vs correlation vs CSV)
  08-COLLECTION-PARSING-RULES.txt -- How to parse Postman v2.1 and Bruno collections
  09-CUSTOM-SCRIPT-CONVERTER.txt  -- Convert pm.test, pm.sendRequest, CryptoJS to DevWeb
  USAGE-GUIDE.txt                 -- Detailed usage guide with copy-paste templates

================================================================================
  ADVANCED USAGE
================================================================================

  For SPECIFIC needs, you can also upload individual prompt files:

  - Converting auth flows?        Upload: 01 + 03 + your collection
  - Need correlation help?        Upload: 01 + 04 + your collection
  - Has complex Postman scripts?  Upload: 01 + 09 + your collection
  - Need data-driven testing?     Upload: 01 + 07 + your collection
  - Just need the config files?   Upload: 06 + your collection name

================================================================================
  TIPS FOR BEST RESULTS
================================================================================

  1. ALWAYS upload 01-MASTER-PROMPT.txt first - it sets the context

  2. If the AI generates parameters.yml with API URLs or client IDs as
     parameters - STOP! That is WRONG. Remind it to read 07-PARAMETERS-YML-RULES

  3. For large collections (50+ requests), ask the AI to process in batches
     of 10-15 requests at a time

  4. Review the generated extractors - AI may miss some correlations
     that require domain knowledge

  5. If your collection has pre-request scripts or test scripts,
     upload 09-CUSTOM-SCRIPT-CONVERTER.txt for accurate conversion

  6. The improved master prompt (01) now forces the AI to output a
     VARIABLE CLASSIFICATION TABLE and CORRELATION MAP before generating
     code - this makes the output much more accurate and reviewable

================================================================================
