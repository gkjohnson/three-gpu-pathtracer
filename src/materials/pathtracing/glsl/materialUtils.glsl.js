export const materialUtilsGLSL = /* glsl */`

	// possibly skip this sample if it's transparent, alpha test is enabled, or we hit the wrong material side
	// and it's single sided.
	// - alpha test is disabled when it === 0
	// - the material sidedness test is complicated because we want light to pass through the back side but still
	// be able to see the front side. This boolean checks if the side we hit is the front side on the first ray
	// and we're rendering the other then we skip it. Do the opposite on subsequent bounces to get incoming light.
	bool evalPassthrough( Material material, float side, float alpha, float r ) {

		float alphaTest = material.alphaTest;
		bool useAlphaTest = alphaTest != 0.0;
		return
			// material sidedness
			material.side != 0.0 && side != material.side

			// alpha test
			|| useAlphaTest && alpha < alphaTest

			// opacity
			|| material.transparent && ! useAlphaTest && alpha < r;

	}

`;
