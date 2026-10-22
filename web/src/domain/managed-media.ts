const managedMediaURL = /^foldnote-asset:\/\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|gif|webp|heic|heif|mp3|m4a|wav|mp4|mov|webm)$/;
export function isManagedMediaURL(value: string): boolean { return managedMediaURL.test(value); }
