export const envMapStructGLSL = /* glsl */`

	struct EquirectHdrInfo {

		sampler2D marginalWeights;
		sampler2D conditionalWeights;
		sampler2D map;

		float totalSumWhole;
		float totalSumDecimal;

	};

`;
