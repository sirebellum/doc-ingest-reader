const json = JSON.stringify({text: '<span class="highlight">hello</span> and <mark>world</mark>'});
const regex = /<span class=\\?"highlight\\?">([\s\S]*?)<\/span>|<mark>([\s\S]*?)<\/mark>/g;
let match;
while ((match = regex.exec(json)) !== null) console.log(match[1] || match[2]);
