import {parseSchedule, writeCsv,} from "./parser.ts";


export function setupUploader(element: HTMLDivElement) {
    element.innerHTML = `
        <div id="drop-area">
        
          <form class="my-form">
            <p>1. Dra eller välj schema-fil (csv)</p>
            <input type="file" id="fileElem" accept="text/csv">
            <label class="button" for="fileElem">Välj</label>
          </form>
        </div>
    `;

    const inputElement = element.querySelector<HTMLInputElement>('input')!;
    inputElement.addEventListener("change", () => {
        handleFiles((inputElement.files as unknown as File[]));
    })

    const dropArea = element.querySelector<HTMLDivElement>("#drop-area");
    if(dropArea != null) {
        connectDragAndDrop(dropArea, document);
    }
}

function getFilename(file: File) {
    const name = file.name.substring(0, file.name.lastIndexOf("."));
    return name;
}

function issueDownload(csv: string, name: string) {
    // Creating a Blob for having a csv file format
    // and passing the data with type
    const blob = new Blob([csv], {type: 'text/csv'});

    // Creating an object for downloading url
    const url = window.URL.createObjectURL(blob)

    // Creating an anchor(a) tag of HTML
    const a = document.createElement('a')

    // Passing the blob downloading url
    a.setAttribute('href', url)

    // Setting the anchor tag attribute for downloading
    // and passing the download file name
    a.setAttribute('download', `${name}-ical.csv`);

    // Performing a download with click
    a.click()
}

function handleFiles(files: File[] | null) {
    if(files && files.length > 0) {
        handleFile(files[0]);
    } else {
        console.error("No file");
        return;
    }
}

async function handleFile(file: File){
    const name = getFilename(file);
    const fileContent = await file.text();
    const schedule = parseSchedule(fileContent);
    const csv = writeCsv(schedule);
    issueDownload(csv, name);
}

function preventDefaults (e: Event) {
    e.preventDefault()
    e.stopPropagation()
}

function handleDrop(e: any) {
    var dt = e.dataTransfer
    var files = dt.files

    handleFiles(files)
}

function connectDragAndDrop(dropArea: HTMLDivElement, document: Document) {

    // let dropArea = document.getElementById("drop-area")

    // Prevent default drag behaviors
    ;['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false)
        document.body.addEventListener(eventName, preventDefaults, false)
    })

    // Highlight drop area when item is dragged over it
    const highlight = () => dropArea.classList.add('highlight');
    const unhighlight = () => dropArea.classList.remove('highlight');
    ;['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => highlight, false)
    })
    ;['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, unhighlight, false)
    })

    // Handle dropped files
    dropArea.addEventListener('drop', handleDrop, false)
}

