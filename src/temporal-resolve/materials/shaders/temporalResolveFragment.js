export const fragmentShader = /* glsl */ `
uniform sampler2D inputTexture;
uniform sampler2D samplesTexture;
uniform sampler2D accumulatedSamplesTexture;
uniform sampler2D velocityTexture;
uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform float samples;

uniform float temporalResolveMix;
uniform int clampRing;
uniform float newSamplesSmoothing;
uniform float newSamplesCorrection;

uniform mat4 curInverseProjectionMatrix;
uniform mat4 curCameraMatrixWorld;

uniform mat4 prevInverseProjectionMatrix;
uniform mat4 prevCameraMatrixWorld;

uniform float cameraNear;
uniform float cameraFar;

varying vec2 vUv;

#include <packing>

// credits for transforming screen position to world position: https://discourse.threejs.org/t/reconstruct-world-position-in-screen-space-from-depth-buffer/5532/2
vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 inverseProjectionMatrix, mat4 cameraMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = inverseProjectionMatrix * ndc;
    vec4 view = cameraMatrixWorld * (clip / clip.w);

    return view.xyz;
}

void main() {
	vec4 samplesTexel = texture2D(samplesTexture, vUv);

	// in case this pixel is from a tile that wasn't rendered yet
	if(samplesTexel.a == 0.){
		gl_FragColor = vec4(texture2D(inputTexture, vUv).rgb, 0.);
		return;
	}

	vec4 depthTexel = texture2D(depthTexture, vUv);
		
	// background doesn't need reprojection
	if(length(depthTexel.xyz) == 0.){
		gl_FragColor = samplesTexel;
		return;
	}

	float unpackedDepth = unpackRGBAToDepth(depthTexel);
	vec3 curWorldPos = screenSpaceToWorldSpace(vUv, unpackedDepth, curInverseProjectionMatrix, curCameraMatrixWorld);


	ivec2 size = textureSize(samplesTexture, 0);
	vec2 pxSize = vec2(float(size.x), float(size.y));

    vec4 velocityTexel = texture2D(velocityTexture, vUv);

    vec2 velUv = velocityTexel.xy;
    float movement = length(velUv) * 100.;

    vec2 reprojectedUv = vUv - velUv;

	float lastUnpackedDepth = unpackRGBAToDepth(texture2D(lastDepthTexture, reprojectedUv));

	vec3 lastWorldPos = screenSpaceToWorldSpace(vUv, lastUnpackedDepth, prevInverseProjectionMatrix, prevCameraMatrixWorld);

	float distToLastFrame = pow(distance(curWorldPos, lastWorldPos), 2.) * 0.25;

	vec4 accumulatedSamplesTexel;
    vec3 newColor;
	float alpha;

	// check that the reprojected UV is valid
	if (reprojectedUv.x >= 0. && reprojectedUv.x <= 1. && reprojectedUv.y >= 0. && reprojectedUv.y <= 1.) {
		accumulatedSamplesTexel = texture2D(accumulatedSamplesTexture, reprojectedUv);
		alpha = accumulatedSamplesTexel.a;
        alpha = distToLastFrame < 0.05 ? (0.1 + alpha) : 0.;
		
		vec2 px = 1. / pxSize;

		vec3 minNeighborColor = vec3(1., 1., 1.);
		vec3 maxNeighborColor = vec3(0., 0., 0.);

		vec3 totalColor;

		// use a small ring if there is a lot of movement otherwise there will be more smearing
		int ring = movement > 1. ? 1 : clampRing;
		
		for(int x = -ring; x <= ring; x++){
			for(int y = -ring; y <= ring; y++){
				vec3 col;

				if(x == 0 && y == 0){
					col = samplesTexel.rgb;
				}else{
					vec2 curOffset = vec2(float(x), float(y));

					col = textureLod(samplesTexture, vUv + px * curOffset, 0.).rgb;
				}

				minNeighborColor = min(col, minNeighborColor);
				maxNeighborColor = max(col, maxNeighborColor);

				if(x <= 1 && x >= -1 && y <= 1 && y >= -1) totalColor += col;
			}
		}

		// clamp the reprojected frame (neighborhood clamping)
		accumulatedSamplesTexel.rgb = clamp(accumulatedSamplesTexel.rgb, minNeighborColor, maxNeighborColor);

		if(newSamplesSmoothing != 0. && alpha < 1.){
			totalColor /= 9.;
			samplesTexel.rgb = mix(samplesTexel.rgb, totalColor, newSamplesSmoothing);
		}
	} else {
		// reprojected UV coordinates are outside of screen, so just use the current frame for it
		alpha = 0.;
		accumulatedSamplesTexel.rgb = samplesTexel.rgb;
	}

	float m = (1. - min(movement * 2., 1.) * (1. - temporalResolveMix)) - (samples - 1.) * 0.01 - 0.025;
	
	m = clamp(m, 0., 1.);
	
	newColor = accumulatedSamplesTexel.rgb * m + samplesTexel.rgb * (1. - m);

	// alpha will be below 1 if the pixel is "new" (e.g. it became disoccluded recently)
	// so make the final color blend more towards the new pixel
	if(alpha < 1.){
		float correctionMix = min(movement, 0.5) * newSamplesCorrection;

		newColor = mix(newColor, samplesTexel.rgb, correctionMix);
	}

    gl_FragColor = vec4(newColor, alpha);
}
`;
