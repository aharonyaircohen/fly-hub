# Definition versioning

Status: **Future consolidation**

Versioning is inconsistent today:

- local Agent bundles use content-derived versions and current heads;
- Workflows use their Convex record contract;
- Capabilities use `repoDocs` bundles;
- simple Loops overwrite repository JSON files;
- the published Engine uses the older versioned Agency definition model.

Do not claim one shared revision system. A future migration should choose one
published contract, use immutable revisions where replay requires them, and
remove competing head-selection logic.
