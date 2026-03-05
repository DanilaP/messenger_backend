import fs from 'fs';

interface IFile {
    url: string,
    name: string,
    size: number,
    type: string
}

async function uploadFiles (files: any) {
    if (files && Object.keys(files).length !== 0) {
        const uploadedFiles = files.files.length > 0 ? files.files : [files.files];
        let filelist: IFile[] = [];

        await uploadedFiles.map((file: any) => {
            const fileName = Buffer.from(file.name, 'latin1').toString('utf8');
            const currentDate = Date.now();
            const uniqueFileStats = `${ currentDate + "_" + file.size + "_"  + fileName }`;

            file.mv(`./static/files/${ uniqueFileStats  }`, function (err: Error) {
                if (err) {
                    console.log(err);
                } 
            });

            filelist = [...filelist, {
                url: `${ process.env.HOST_URL }/files/${ uniqueFileStats }`,
                name: fileName,
                size: file.size,
                type: file.mimetype
            }];
        });
        return { filelist, status: 200 };
    } 
    return { filelist: [], status: 500 };
}

async function removeFiles (filesURL: string[]) {
    let status = 200;
    if (filesURL.length !== 0) {
        filesURL.map(url => {
            fs.unlink(url as string, (err) => {
                if (err) {
                    status = 500;
                }
            });
        })
    }
    return { status };
}


export default { uploadFiles, removeFiles };