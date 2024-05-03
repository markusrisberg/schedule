export class WorkDay {
    // Vecka; Datum; Dag; Från; Till; Kod; Rast; Tid; Arbetsplats; Anteckningar
    // 30; 2024-07-22; Mån; 07:00; 17:15; .TJG; 00:30; 09:45; ;
    date: string;
    from: string;
    to: string;
    code: string;
    notes: string;

    constructor(data: string[]) {
        if(data.length != 10) {
            throw new Error("Invalida data: " + data);
        }

        this.date = data[1].trim();
        this.from = data[3].trim();
        this.to = data[4].trim();
        this.code = data[5].trim();
        this.notes = data[9].trim();
    }

    isValid(): boolean {
        return this.code === ".TJG";
    }

    isOnCall(): boolean {
        return this.to === "23:00" && this.notes.includes("MR")
    }

    toString(): string {
        return `${this.date} ${this.from}-${this.to} ${this.code} ${this.notes}`;
    }

    toCSV(): string {
        return [this.getDescription(),this.toLocaleDate(), this.toLocaleTime(this.from), this.toLocaleDate(), this.toLocaleTime(this.to), "False", "", "", "True"].join(",");
    }

    private toLocaleDate(): string {
        const date = new Date(this.date);
        return date.toLocaleDateString("en-us", {day: "2-digit", month: "2-digit", year: "numeric"});
    }

    private toLocaleTime(time: string): string {
        const date = new Date(`${this.date}T${time}`);
        return date.toLocaleTimeString("en-us", {hour: "2-digit", minute: "2-digit"});
    }

    private getDescription(): string {
        let description = this.isEvening() ? "Jobb kväll" : "Jobb dag"
        if(this.isOnCall()) {
            description = description + " (beredskap)";
        }
        return description;
    }

    private isEvening(): boolean {
        return this.toLocaleTime(this.from).includes("PM");
    }
}

export function parseSchedule(content: string) {
    let rows = content.split("\n");
    rows = stripMetadata(rows);
    const days = rows.map(r => new WorkDay(r.split(";")));
    return days.filter(day => day.isValid());
}

export function writeCsv(workDays: WorkDay[]): string {
    const rows = ["Subject,Start Date,Start Time,End Date,End Time,All Day Event,Description,Location,Private"]
    rows.push(...workDays.map(w => w.toCSV()));
    return rows.join("\n");
}
function stripMetadata(rows: string[]): string[] {
    const headerRowIndex = rows.findIndex(r => r.startsWith(" Vecka"));
    if(headerRowIndex < 0) {
        return rows;
    }
    const withoutHead = rows.slice(headerRowIndex + 1);

    const separatorRowIndex = withoutHead.findIndex(r => r.startsWith(";;;;;;;;;"))
    return withoutHead.splice(0, separatorRowIndex);

}
