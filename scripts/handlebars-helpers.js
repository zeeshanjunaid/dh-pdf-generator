// Shared Handlebars helpers for all scripts
export function registerHelpers(Handlebars) {
  // Simple equality helper for section filtering
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // Block equality helper for conditional rendering
  Handlebars.registerHelper("ifEq", function(a, b, options) {
    return a === b ? options.fn(this) : options.inverse(this);
  });

  // Increment helper for index + 1
  Handlebars.registerHelper("inc", function(value) {
    return parseInt(value) + 1;
  });

  // Split string by delimiter and trim each item
  Handlebars.registerHelper("split", function(str, delimiter) {
    if (!str) return [];
    return str.split(delimiter).map(item => item.trim()).filter(item => item.length > 0);
  });

  // Split by newlines or comma, handling actual newline characters
  Handlebars.registerHelper("splitLines", function(str, delimiter) {
    if (!str) return [];
    
    const text = String(str);
    const actualDelimiter = (typeof delimiter === 'string') ? delimiter : undefined;
    
    if (actualDelimiter) {
      return text.split(actualDelimiter).map(item => item.trim()).filter(item => item.length > 0);
    }
    
    return text.split(/[\r\n]+/).map(item => item.trim()).filter(item => item.length > 0);
  });

  // Strip bullet points (• or -) from the beginning of strings
  Handlebars.registerHelper("stripBullet", function(str) {
    if (!str) return "";
    return String(str).replace(/^[•\-\*]\s*/, "").trim();
  });

  // Format date helpers
  Handlebars.registerHelper("formatDate", function(dateString) {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toISOString().split('T')[0];
    } catch (e) {
      return dateString;
    }
  });

  Handlebars.registerHelper("formatDateNice", function(dateString) {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateString;
    }
  });

  Handlebars.registerHelper("parseDate", function(dateString) {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateString;
    }
  });

  Handlebars.registerHelper("currentDate", function() {
    return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  // Extract stage/grade information
  Handlebars.registerHelper("extractStageIndicator", function(stageValue) {
    if (!stageValue) return "--";
    const indicator = stageValue.replace(/Stage\s*/i, "").trim();
    return indicator || "--";
  });

  Handlebars.registerHelper("extractGradeNumber", function(gradeValue) {
    if (!gradeValue) return "--";
    const match = gradeValue.match(/Grade\s*(\d+)/i);
    return match ? match[1] : "--";
  });

  // Group treatments by treatment_section, then by table_title
  // Returns: [{section, section_name, tables: [{title, description, rows: [...]}]}]
  Handlebars.registerHelper("groupTreatments", function(treatments, options) {
    if (!treatments || !Array.isArray(treatments) || treatments.length === 0) {
      return options.inverse(this);
    }
    
    const sections = {};
    
    treatments.forEach(treatment => {
      const sectionKey = treatment.treatment_section || "Other";
      const tableTitle = treatment.table_title || "Treatments";
      
      if (!sections[sectionKey]) {
        sections[sectionKey] = {
          section: sectionKey,
          section_name: sectionKey.replace(/^\d+\s*-\s*/, ''), // Remove "1 - " prefix
          tables: {}
        };
      }
      
      if (!sections[sectionKey].tables[tableTitle]) {
        sections[sectionKey].tables[tableTitle] = {
          title: tableTitle,
          description: treatment.table_description || '',
          rows: []
        };
      }
      
      sections[sectionKey].tables[tableTitle].rows.push(treatment);
    });
    
    // Convert to arrays and sort
    const sectionsArray = Object.values(sections).map(section => ({
      ...section,
      tables: Object.values(section.tables).map(table => ({
        ...table,
        rows: table.rows.sort((a, b) => (a.row_order || 0) - (b.row_order || 0))
      }))
    }));
    
    // Sort sections by key (1 - Medical, 2 - Surgical, 3 - Radiation)
    sectionsArray.sort((a, b) => a.section.localeCompare(b.section));
    
    return sectionsArray.map(section => options.fn(section)).join('');
  });
}
