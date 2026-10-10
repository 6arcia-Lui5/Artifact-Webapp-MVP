export const recordFields = [
  // Identification
  {
    key: "itemName",
    label: "Item Name",
    type: "text",
    required: true,
    placeholder: "Enter a name for your item",
  },
  {
    key: "hhwIdentifier",
    label: "Unique Identifier within HHW (if assigned)",
    type: "text",
    required: false,
    placeholder: "1.1.3",
  },
  {
    key: "objectTypeId",
    label: "Object Type",
    type: "object-type",
    required: true,
    placeholder: "ring, medallion, coin, cup",
  },

  // Museum
  {
    key: "museumName",
    label: "Museum or Institute's Name",
    type: "text",
    required: true,
    placeholder: "Metropolitan Museum",
  },
  {
    key: "museumDepartment",
    label: "Museum Department",
    type: "text",
    required: false,
    placeholder: "Ancient Roman Coins",
  },
  {
    key: "museumCity",
    label: "City",
    type: "text",
    required: true,
    placeholder: "New York City, New York",
  },
  {
    key: "museumCountry",
    label: "Country",
    type: "text",
    required: true,
    placeholder: "United States",
  },
  {
    key: "museumNumber",
    label: "Museum or Institute Number",
    type: "text",
    required: true,
    placeholder: "1123.4231",
  },
  {
    key: "museumDescription",
    label: "Museum or Institute Description",
    type: "textarea",
    required: false,
  },

  // Dating / Classification
  {
    key: "dateCulturePeriod",
    label: "Date / Culture / Time Period",
    type: "text",
    required: false,
  },
  {
    key: "datingBasis",
    label: "Basis for Dating",
    type: "text",
    required: false,
    placeholder: "e.g. coin date",
  },
  {
    key: "issuingAuthority",
    label: "Issuing Authority",
    type: "text",
    required: false,
  },

  // Production / Discovery
  {
    key: "productionPlace",
    label: "Place of Production",
    type: "text",
    required: false,
  },
  {
    key: "findspot",
    label: "Findspot",
    type: "text",
    required: false,
  },
  {
    key: "acquisitionDate",
    label: "Acquisition Date",
    type: "text",
    required: false,
  },
  {
    key: "excavationInformation",
    label: "Excavation Information",
    type: "textarea",
    required: false,
  },

  // Physical Description
  {
    key: "materials",
    label: "Materials",
    type: "text",
    required: true,
  },
  {
    key: "technique",
    label: "Technique",
    type: "text",
    required: false,
  },
  {
    key: "dimensions",
    label: "Dimensions",
    type: "text",
    required: true,
    placeholder: "50mm Circumference",
  },
  {
    key: "thickness",
    label: "Thickness",
    type: "text",
    required: false,
  },
  {
    key: "weight",
    label: "Weight",
    type: "text",
    required: false,
  },

  // Scientific Testing
  {
    key: "scientificTesting",
    label: "Scientific Testing",
    type: "textarea",
    required: false,
    placeholder: "Please include bibliography where applicable",
  },

  // Inscription
  {
    key: "inscribed",
    label: "Inscribed?",
    type: "checkbox",
    required: false,
  },

  // These are conditional
  {
    key: "inscriptionLanguage",
    label: "Language of Inscription",
    type: "text",
    required: true,
    condition: {
      field: "inscribed",
      value: true,
    },
  },
  {
    key: "inscriptionTranslationEn",
    label: "Translation (English)",
    type: "textarea",
    required: false,
    condition: {
      field: "inscribed",
      value: true,
    },
  },
  {
    key: "inscriptionScript",
    label: "Script Used",
    type: "text",
    required: true,
    condition: {
      field: "inscribed",
      value: true,
    },
  },
  {
    key: "inscriptionSerifs",
    label: "Serifs Present?",
    type: "checkbox",
    required: false,
    condition: {
      field: "inscribed",
      value: true,
    },
  },
  {
    key: "inscriptionStopmarks",
    label: "Stopmarks Present?",
    type: "checkbox",
    required: false,
    condition: {
      field: "inscribed",
      value: true,
    },
  },

  // Imagery
  {
    key: "imagery",
    label: "Imagery?",
    type: "checkbox",
    required: false,
  },
  {
    key: "imageryDescription",
    label: "Description of Imagery",
    type: "textarea",
    required: true,
    condition: {
      field: "imagery",
      value: true,
    },
  },
  {
    key: "imageryInscriptionPlacement",
    label: "Placement of Imagery and Inscription",
    type: "textarea",
    required: true,
    condition: {
      field: "imagery",
      value: true,
    },
  },
  {
    key: "imageSourceUrl",
    label: "Image Source URL",
    type: "url",
    required: false,
    condition: {
      field: "imagery",
      value: true,
    },
  },
  {
    key: "imageType",
    label: "Image Type",
    type: "select",
    required: false,
    condition: {
      field: "imagery",
      value: true,
    },
    options: [
      { value: "color", label: "Color" },
      { value: "black_and_white", label: "Black and White" },
    ],
  },
  {
    key: "bibliography",
    label: "Bibliography",
    type: "textarea",
    required: false,
    condition: {
      field: "imagery",
      value: true,
    },
  },
  {
    key: "imageCopyrightDetails",
    label: "Image Copyright Details",
    type: "textarea",
    required: false,
    condition: {
      field: "imagery",
      value: true,
    },
  },
];
