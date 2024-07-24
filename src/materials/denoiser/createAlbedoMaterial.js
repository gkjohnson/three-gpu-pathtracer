import { Color, ShaderMaterial } from 'three';

export function createAlbedoShaderMaterial( originalMaterial ) {

	// Vertex shader (same as before)
	const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

	// Fragment shader (same as before, but we'll add it here for completeness)
	const fragmentShader = /* glsl */`
    uniform vec3 diffuseColor;
    uniform sampler2D diffuseMap;
    uniform float metalness;
    uniform float roughness;
    uniform float transmission;
    uniform float ior;
    uniform float clearcoat;
    uniform float clearcoatRoughness;

    varying vec2 vUv;

    float fresnelSchlick(float cosTheta, float F0) {
      return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
    }

    vec4 LinearToSRGB(vec4 value) {
      vec3 linearRGB = value.rgb;
      vec3 sRGB = vec3(0.0); // Initialize sRGB to zero
    
      for (int i = 0; i < 3; ++i) {
        if (linearRGB[i] <= 0.0031308) {
          sRGB[i] = 12.92 * linearRGB[i];
        } else {
          sRGB[i] = 1.055 * pow(linearRGB[i], 1.0 / 2.4) - 0.055;
        }
      }
    
      return vec4(sRGB, value.a);
    }

    void main() {
      vec3 albedo;
      
      vec3 baseColor = texture2D(diffuseMap, vUv).rgb * diffuseColor;
      
      if (transmission > 0.0) {
        albedo = vec3(1.0);
      } else if (metalness > 0.0) {
        float F0 = (baseColor.r + baseColor.g + baseColor.b) / 3.0;
        albedo = vec3(F0);
      } else {
        float F0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
        float fresnel = fresnelSchlick(0.5, F0);
        
        if (roughness < 0.01) {
          albedo = mix(baseColor, vec3(1.0), fresnel);
        } else {
          albedo = baseColor;
        }
      }
      
      if (clearcoat > 0.0) {
        float clearcoatF0 = 0.04;
        float clearcoatFresnel = fresnelSchlick(0.5, clearcoatF0);
        albedo = mix(albedo, vec3(1.0), clearcoat * clearcoatFresnel);
      }
      
      albedo = clamp(albedo, 0.0, 1.0);
      
      gl_FragColor = LinearToSRGB(LinearToSRGB(vec4(albedo, 1.0)));
    }
  `;

	// Set up uniforms based on the original material type and properties
	const uniforms = {
		diffuseColor: { value: new Color( 1, 1, 1 ) },
		diffuseMap: { value: null },
		metalness: { value: 0 },
		roughness: { value: 1 },
		transmission: { value: 0 },
		ior: { value: 1.5 },
		clearcoat: { value: 0 },
		clearcoatRoughness: { value: 0 },
	};

	if ( originalMaterial.isMeshBasicMaterial ) {

		uniforms.diffuseColor.value = originalMaterial.color;
		uniforms.diffuseMap.value = originalMaterial.map;

	} else if ( originalMaterial.isMeshStandardMaterial ) {

		uniforms.diffuseColor.value = originalMaterial.color;
		uniforms.diffuseMap.value = originalMaterial.map;
		uniforms.metalness.value = originalMaterial.metalness;
		uniforms.roughness.value = originalMaterial.roughness;

	} else if ( originalMaterial.isMeshPhysicalMaterial ) {

		uniforms.diffuseColor.value = originalMaterial.color;
		uniforms.diffuseMap.value = originalMaterial.map;
		uniforms.metalness.value = originalMaterial.metalness;
		uniforms.roughness.value = originalMaterial.roughness;
		uniforms.transmission.value = originalMaterial.transmission;
		uniforms.ior.value = originalMaterial.ior;
		uniforms.clearcoat.value = originalMaterial.clearcoat;
		uniforms.clearcoatRoughness.value = originalMaterial.clearcoatRoughness;

	} else {

		console.warn( 'Unsupported material type. Falling back to default values.' );

	}

	// Create and return the new ShaderMaterial
	return new ShaderMaterial( {
		vertexShader,
		fragmentShader,
		uniforms,
	} );

}

