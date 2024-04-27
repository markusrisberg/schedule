import {expect} from "chai";
import {parseSchedule, WorkDay, writeCsv} from "./parser.ts";

function stripMetadata(rows: string[]): string[] {
    const headerRowIndex = rows.findIndex(r => r.startsWith(" Vecka"));
    const withoutHead = rows.slice(headerRowIndex + 1);

    const separatorRowIndex = withoutHead.findIndex(r => r.startsWith(";;;;;;;;;"))
    return withoutHead.splice(0, separatorRowIndex);

}

async function readFile(path: string) {
    const response = await fetch(path);
    return await response.text();
}

const VALID_DAY = "; 2024-07-04; Tors; 15:00; 23:00; .TJG; 00:30; 07:30; ;";
const VALID_DAY_ON_CALL = "; 2024-07-04; Tors; 15:00; 23:00; .TJG; 00:30; 07:30; ; MR";
const INVALID_DAY = "; 2024-07-05; Tors; 15:00; 23:00; PSEM; 00:30; 07:30; ; MR";

describe("parseSchedule", () => {
    let fileContents: string;

    beforeEach(async () => {
        fileContents = await readFile("/202404.csv");
    })

    it("parse a file", async () => {

        const workDays = parseSchedule(fileContents);
        // workDays.forEach(w => console.log(w.toString()));
        expect(workDays.length).to.equal(46);

    })

    it("should render some output", () => {
        const workDays = parseSchedule(fileContents);
        const output = writeCsv(workDays);
        console.log(output);
    })

    it("should parse a single day", () => {
        const workDays = parseSchedule(VALID_DAY);
        expect(workDays.length).to.equal(1);
        expect(workDays[0].date).to.equal("2024-07-04");
        expect(workDays[0].from).to.equal("15:00");
        expect(workDays[0].to).to.equal("23:00");
        expect(workDays[0].code).to.equal(".TJG");
    })

    it("should ignore invalid entries", () => {
        expect(parseSchedule(VALID_DAY).length).to.equal(1);
        expect(parseSchedule(INVALID_DAY).length).to.equal(0);
    })

    it("should not detect on-call if work ends at 23:00 and note includes MR", () => {
        const [workDay] = parseSchedule(VALID_DAY);
        expect(workDay.isOnCall()).to.be.false;
    })

    it("should detect on-call if work ends at 23:00 and note does not includes MR", () => {
        const [workDay] = parseSchedule(VALID_DAY_ON_CALL);
        expect(workDay.isOnCall()).to.be.true;
    })
})

describe("toCSV", () => {
    /*
Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private
Jobb dag,04/08/2019,07:15 AM,04/08/2019,03:15 PM,False,Vecka 15,PÄS,True
Jobb kväll,04/10/2019,04:00 PM,04/10/2019,10:45 PM,False,Vecka 15,PÄS,True
Beredskap,04/10/2019,10:45 PM,04/10/2019,12:00 PM,False,Vecka 15,PÄS,True
Jobb dag,04/11/2019,07:15 AM,04/11/2019,03:00 PM,False,Vecka 15,PÄS,True
Jobb kväll,04/12/2019,03:00 PM,04/12/2019,10:45 PM,False,Vecka 15,PÄS,True
Beredskap,04/12/2019,10:45 PM,04/12/2019,12:00 PM,False,Vecka 15,PÄS,True
Jobb dag,04/13/2019,09:00 AM,04/13/2019,05:00 PM,False,Vecka 15,PÄS,True
     */

    it("should format date properly", () => {
        const [workDay] = parseSchedule(VALID_DAY);
        expect(workDay.toCSV()).to.include("07/04/2024");
    })
    it("should format time properly", () => {
        const [workDay] = parseSchedule(VALID_DAY);
        expect(workDay.toCSV()).to.include("03:00 PM;11:00 PM");
    })
    it("should format day correctly", () => {
        const input = "; 2024-07-04; Tors; 15:00; 23:00; .TJG; 00:30; 07:30; ;";
        const [workDay] = parseSchedule(input);

        expect(workDay.toCSV()).to.equal("Jobb kväll;07/04/2024;03:00 PM;11:00 PM;False;;;True");
    })
    it("should format evening correctly", () => {
        const input = "; 2024-07-04; Tors; 07:00; 15:00; .TJG; 00:30; 07:30; ;";
        const [workDay] = parseSchedule(input);

        expect(workDay.toCSV()).to.equal("Jobb dag;07/04/2024;07:00 AM;03:00 PM;False;;;True");
    })
    it("should format on call correctly", () => {
        const input = "; 2024-07-04; Tors; 15:00; 23:00; .TJG; 00:30; 07:30; ; MR";
        const [workDay] = parseSchedule(input);

        expect(workDay.toCSV()).to.equal("Jobb kväll (beredskap);07/04/2024;03:00 PM;11:00 PM;False;;;True");
    })


})

