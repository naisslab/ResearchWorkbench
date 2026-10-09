const labels = {
  ml: {
    name: "ML Systems",
    previous: ["MLSys", "ML for Systems", "ML & Networked Systems"],
    color: "#087cba",
  },
  security: {
    name: "Security and Privacy",
    previous: ["Security&Privacy", "Security", "Security & Privacy"],
    color: "#ab6f05",
  },
  cps: {
    name: "Cyber-Physical Systems",
    previous: ["CPS", "Cyber-Physical Systems", "Cyber-Physical Intelligence"],
    color: "#a04a95",
  },
};
const previousColors = new Set([
  "#75a6d9",
  "#b89875",
  "#8e95bc",
  "#80b7b0",
  "#d0aa70",
  "#a3a9d9",
  "#91a9d8",
  "#b2a0d3",
  "#9daec7",
]);

function migrateAreaLabels(state) {
  if (state.areaLabelVersion === 2) return state;
  return {
    ...state,
    areaLabelVersion: 2,
    areas: state.areas.map((area) => {
      const label = labels[area.id];
      if (!label) return area;
      return {
        ...area,
        name: label.previous.includes(area.name) ? label.name : area.name,
        color: previousColors.has(area.color.toLowerCase())
          ? label.color
          : area.color,
      };
    }),
  };
}

module.exports = { migrateAreaLabels };
