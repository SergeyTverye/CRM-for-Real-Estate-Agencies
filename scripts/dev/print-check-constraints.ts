

import { CODEBOOK_COLUMNS, checkConstraintSql } from "../../src/shared/codebook";

for (const entry of CODEBOOK_COLUMNS) console.log(checkConstraintSql(entry));
