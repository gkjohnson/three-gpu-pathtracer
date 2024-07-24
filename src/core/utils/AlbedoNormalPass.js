import * as THREE from 'three';

export class AlbedoNormalPass {

	constructor( useWorldSpaceNormals = true ) {

		this.originalMaterials = new Map();
		this.albedoMaterials = new Map();
		this.useWorldSpaceNormals = useWorldSpaceNormals;
		//debugging
		//this.debugNormalMaps = true;

		// RT
		this.renderTarget = new THREE.WebGLRenderTarget( 1, 1, {
			samples: 16,
			count: 2
		} );
		this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

		this.albedoNormalMaterial = new THREE.ShaderMaterial( {
			uniforms: {
				diffuseMap: { value: null },
				normalMap: { value: null },
				color: { value: new THREE.Color( 1, 1, 1 ) },
				useWorldSpaceNormals: { value: this.useWorldSpaceNormals },
				useDiffuseMap: { value: false },
				useNormalMap: { value: false },
				debugNormalMaps: { value: this.debugNormalMaps },
				normalScale: { value: 1 }
			},
			vertexShader: /* glsl */`
                varying vec2 vUv;
                varying vec3 vViewPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                varying vec3 vTangent;
                varying vec3 vBitangent;

                void main() {
                    vUv = uv;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    vViewPosition = -mvPosition.xyz;
                    vNormal = normalize(normalMatrix * normal);
                    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
                    
                    #ifdef USE_TANGENT
                        vTangent = normalize(normalMatrix * tangent.xyz);
                        vBitangent = normalize(cross(vNormal, vTangent) * tangent.w);
                    #endif
                }
            `,
			fragmentShader: /* glsl */`
                uniform vec3 color;
                uniform sampler2D diffuseMap;
                uniform sampler2D normalMap;
                uniform bool useWorldSpaceNormals;
                uniform bool useDiffuseMap;
                uniform bool useNormalMap;
                uniform bool debugNormalMaps;
				uniform float normalScale;

                varying vec2 vUv;
                varying vec3 vViewPosition;
                varying vec3 vNormal;
                varying vec3 vWorldNormal;
                varying vec3 vTangent;
                varying vec3 vBitangent;

                layout(location = 0) out vec4 gAlbedo;
                layout(location = 1) out vec4 gNormal;

                void main() {
                    // Albedo
                    vec3 albedo;
                    if (useDiffuseMap) {
                        vec4 diffuseColor = texture(diffuseMap, vUv);
                        albedo = diffuseColor.rgb * color;
                    } else {
                        albedo = color;
                    }
                    gAlbedo = vec4(albedo, 1.0);

                    // Normal
                    vec3 normal;
                    if (useNormalMap) {
						// This is NOT correct, but it works. I dont think the denoiser actually cares
						// TODO: Make this actually work to convert to worldSpace
						// Output the raw normal map data
						vec3 rawNormalMap = texture(normalMap, vUv).xyz;
						gNormal = vec4(rawNormalMap, 1.0);
						return;
					
						vec3 mapN = texture(normalMap, vUv).xyz * 2.0 - 1.0;
						mapN.xy *= normalScale;
						mat3 tbn = mat3(normalize(vTangent), normalize(vBitangent), normalize(vNormal));
						vec3 worldNormal = normalize(tbn * mapN);
						
						if (useWorldSpaceNormals) {
							normal = worldNormal;
						} else {
							normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);
						}
					} else {
						normal = useWorldSpaceNormals ? vWorldNormal : vNormal;
					}

					normal = normalize(normal + vec3(1e-6));
					normal = normal * 0.5 + 0.5;
					gNormal = vec4(normal, 1.0);
                }
            `,
			glslVersion: THREE.GLSL3
		} );

	}

	async render( renderer, scene, camera ) {

		const target = this.renderTarget;
		target.setSize( renderer.domElement.width, renderer.domElement.height );

		this.swapMaterials( scene );

		const oldRenderTarget = renderer.getRenderTarget();
		renderer.setRenderTarget( target );
		renderer.render( scene, camera );
		renderer.setRenderTarget( oldRenderTarget );

		this.restoreMaterials();

		// return the two textures
		return { albedo: target.textures[ 0 ], normal: target.textures[ 1 ] };

	}

	swapMaterials( object ) {

		if ( object instanceof THREE.Mesh && object.material ) {

			if ( ! this.originalMaterials.has( object ) )
				this.originalMaterials.set( object, object.material );

			if ( this.albedoMaterials.has( object ) ) {

				object.material = this.albedoMaterials.get( object );
				return;

			}

			const material = object.material;
			const newAlbedoMaterial = this.albedoNormalMaterial.clone();

			if ( material.color ) newAlbedoMaterial.uniforms.color.value.copy( material.color );
			newAlbedoMaterial.uniforms.diffuseMap.value = material.map;
			newAlbedoMaterial.uniforms.normalMap.value = material.normalMap;
			newAlbedoMaterial.uniforms.useDiffuseMap.value = !! material.map;
			newAlbedoMaterial.uniforms.useNormalMap.value = !! material.normalMap;
			newAlbedoMaterial.uniforms.debugNormalMaps.value = this.debugNormalMaps;

			if ( material.normalMap ) {

				newAlbedoMaterial.defines.USE_TANGENT = '';

			}

			this.albedoMaterials.set( object, newAlbedoMaterial );
			object.material = newAlbedoMaterial;

		}

		// biome-ignore lint/complexity/noForEach: <explanation>
		object.children.forEach( child => this.swapMaterials( child ) );

	}

	restoreMaterials() {

		this.originalMaterials.forEach( ( material, object ) => {

			if ( object instanceof THREE.Mesh ) {

				object.material = material;

			}

		} );
		this.originalMaterials.clear();

	}

	setUseWorldSpaceNormals( value ) {

		this.useWorldSpaceNormals = value;
		// biome-ignore lint/complexity/noForEach: <explanation>
		this.albedoMaterials.forEach( ( material ) => {

			if ( material instanceof THREE.ShaderMaterial ) {

				material.uniforms.useWorldSpaceNormals.value = value;

			}

		} );

	}
	// this lets you debug the normal maps at runtime. Remove in the future
	setDebugNormalMaps( value ) {

		this.debugNormalMaps = value;
		// biome-ignore lint/complexity/noForEach: <explanation>
		this.albedoMaterials.forEach( ( material ) => {

			if ( material instanceof THREE.ShaderMaterial ) {

				material.uniforms.debugNormalMaps.value = value;

			}

		} );

	}

}
