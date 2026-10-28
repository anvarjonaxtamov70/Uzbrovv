/* three.js'dan FAQAT 3D konfigurator ishlatadigan qismlar.
 *
 * Nega to'liq three.js emas: npm paketidagi `three.module.js` + `three.core.js`
 * siqilmagan holda 2,1 MB. Bu yerda tree-shaking bilan faqat kerakli klasslar
 * olinadi va bitta siqilgan IIFE (`window.THREE`) yasaladi:
 *
 *     docs/vendor/three.min.js
 *
 * Qayta yig'ish: `sh scripts/build_three_vendor.sh` (versiya o'sha faylda).
 * `docs/js/headlight3d.js` yangi klass ishlatsa — shu ro'yxatga qo'shing.
 */
export {
  REVISION,
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Group,
  Object3D,
  Mesh,
  Sprite,
  Points,
  // materiallar
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  MeshBasicMaterial,
  SpriteMaterial,
  PointsMaterial,
  // geometriya
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  LatheGeometry,
  TorusGeometry,
  CylinderGeometry,
  PlaneGeometry,
  CircleGeometry,
  RingGeometry,
  SphereGeometry,
  BoxGeometry,
  ConeGeometry,
  ShapeGeometry,
  ExtrudeGeometry,
  TubeGeometry,
  Shape,
  Path,
  CatmullRomCurve3,
  // matematika
  Vector2,
  Vector3,
  Color,
  Euler,
  Quaternion,
  Matrix4,
  MathUtils,
  Box3,
  // teksturalar va yorug'lik
  CanvasTexture,
  Texture,
  PMREMGenerator,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  PointLight,
  SpotLight,
  // konstantalar
  SRGBColorSpace,
  LinearSRGBColorSpace,
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  AdditiveBlending,
  NormalBlending,
  DoubleSide,
  FrontSide,
  BackSide,
  ClampToEdgeWrapping,
  RepeatWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
} from "three";
