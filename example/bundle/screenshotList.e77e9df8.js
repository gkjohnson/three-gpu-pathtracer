(async()=>{let e=document.getElementById("container"),{scenarios:t}=await (await fetch("https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json")).json(),a=await (await fetch("https://api.github.com/repos/gkjohnson/three-gpu-pathtracer/commits?sha=screenshots")).json(),s=a[0].sha,n=window.location.hash.replace(/^#/,"")||"model-viewer",o=document.querySelector("select");o.value=n,o.addEventListener("change",()=>{window.location.hash=o.value,n=o.value,i()}),document.body.style.visibility="visible";let r=document.querySelector('input[type="checkbox"]');function i(){e.innerHTML="",t.forEach(t=>{let o;let r=t.name,i=`https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/${s}/screenshots/golden/${r}.png`;o="prior-commit"===n?`https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/${a[1].sha}/screenshots/golden/${r}.png`:`https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/goldens/${r}/${n}-golden.png`,e.innerHTML+=`
				<div>
					<h1>${t.name}</h1>
					<div class="img-wrapper">
						<a href="${i}" target="_blank"><img src="${i}" /></a>
						<a href="${o}" target="_blank"><img src="${o}" /></a>
					</div>
				</div>
			`})}r.addEventListener("change",()=>{r.checked?e.classList.add("large-images"):e.classList.remove("large-images")}),i()})();
//# sourceMappingURL=screenshotList.e77e9df8.js.map
