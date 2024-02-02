const path = require('path');

const config = {
  $schema: "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  projectFolder: "./",
  compiler: {
    tsconfigFilePath: "<projectFolder>/tsconfig.json"
  },
  mainEntryPointFilePath: `<projectFolder>/dist/index.d.ts`,
  apiReport: {
    enabled: true,
    reportFolder: "../../docs/api",
    reportTempFolder: "../../docs/temp/api"
  },
  docModel: {
    enabled: false
  },
  dtsRollup: {
    enabled: false
  },
  tsdocMetadata: {
    enabled: false
  },
  messages: {
    tsdocMessageReporting: {
      default: {
        logLevel: "none"
      }
    },
    extractorMessageReporting: {
      default: {
        logLevel: "error",
        addToApiReportFile: false
      },
      "ae-incompatible-release-tags": {
        logLevel: "error",
        addToApiReportFile: false
      },
      "ae-missing-release-tag": {
        logLevel: ignoreMissingTags ? "none" : "error",
        addToApiReportFile: false
      },
      "ae-internal-missing-underscore": {
        logLevel: "none",
        addToApiReportFile: false
      },
      "ae-forgotten-export": {
        logLevel: "none",
        addToApiReportFile: false
      },
      "ae-unresolved-inheritdoc-reference": {
        logLevel: "error",
        addToApiReportFile: true
      },
      "ae-unresolved-inheritdoc-base": {
        logLevel: "error",
        addToApiReportFile: true
      }
    }
  }
};

const configFileName = `./api-extractor.json`;
fs.writeFileSync(configFileName, JSON.stringify(config, null, 2));