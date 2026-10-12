// A real, empty IFC project supplies job ownership and a stable coordinate
// system. Editable entities live in the versioned ForemanHQ design document.
export const blankCadIfc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ForemanHQ CAD workspace'),'2;1');
FILE_NAME('design.ifc','2026-10-12T00:00:00',('ForemanHQ'),('ForemanHQ'),'ForemanHQ','ForemanHQ','');
FILE_SCHEMA(('IFC2X3'));
ENDSEC;
DATA;
#1=IFCPERSON($,$,'ForemanHQ',$,$,$,$,$);
#2=IFCORGANIZATION($,'ForemanHQ',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1.0','ForemanHQ CAD','FHQ');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);
#6=IFCCARTESIANPOINT((0.,0.,0.));
#7=IFCDIRECTION((0.,0.,1.));
#8=IFCDIRECTION((1.,0.,0.));
#9=IFCAXIS2PLACEMENT3D(#6,#7,#8);
#10=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#9,$);
#11=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#12=IFCUNITASSIGNMENT((#11));
#13=IFCPROJECT('0ForemanHQCAD0000000001',#5,'CAD workspace',$,$,$,$,(#10),#12);
ENDSEC;
END-ISO-10303-21;
`;
