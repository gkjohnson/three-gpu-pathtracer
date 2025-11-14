import"./modulepreload-polyfill-B5Qt9EMX.js";const m="https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/config.json",d="https://api.github.com/repos/gkjohnson/three-gpu-pathtracer/commits?sha=screenshots";(async()=>{const e=document.getElementById("container"),{scenarios:h}=await(await fetch(m)).json(),a=await(await fetch(d)).json(),g=a[0].sha;let t=window.location.hash.replace(/^#/,"")||"model-viewer";const o=document.querySelector("select");o.value=t,o.addEventListener("change",()=>{window.location.hash=o.value,t=o.value,r()}),document.body.style.visibility="visible";const c=document.querySelector('input[type="checkbox"]');c.addEventListener("change",()=>{c.checked?e.classList.add("large-images"):e.classList.remove("large-images")}),r();function r(){e.innerHTML="",h.forEach(i=>{const n=i.name,l=`https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/${g}/screenshots/golden/${n}.png`;let s;t==="prior-commit"?s=`https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/${a[1].sha}/screenshots/golden/${n}.png`:s=`https://raw.githubusercontent.com/google/model-viewer/master/packages/render-fidelity-tools/test/goldens/${n}/${t}-golden.png`,e.innerHTML+=`
				<div>
					<h1>${i.name}</h1>
					<div class="img-wrapper">
						<a href="${l}" target="_blank"><img src="${l}" /></a>
						<a href="${s}" target="_blank"><img src="${s}" /></a>
					</div>
				</div>
			`})}})();
