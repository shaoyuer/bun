const assert = require("node:assert");
const nativeTests = require("./build/Debug/napitests.node");
const secondAddon = require("./build/Debug/second_addon.node");
const asyncFinalizeAddon = require("./build/Debug/async_finalize_addon.node");

async function gcUntil(fn) {
  const MAX = 100;
  for (let i = 0; i < MAX; i++) {
    await new Promise(resolve => {
      setTimeout(resolve, 1);
    });
    if (typeof Bun == "object") {
      Bun.gc(true);
    } else {
      // if this fails, you need to pass --expose-gc to node
      global.gc();
    }
    if (fn()) {
      return;
    }
  }
  throw new Error(`Condition was not met after ${MAX} GC attempts`);
}

nativeTests.test_napi_class_constructor_handle_scope = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  const x = new NapiClass();
  console.log("x.foo =", x.foo);
};

nativeTests.test_napi_handle_scope_finalizer = async () => {
  // Create a weak reference, which will be collected eventually
  // Pass false in Node.js so it does not create a handle scope
  nativeTests.create_ref_with_finalizer(Boolean(process.isBun));

  // Wait until it actually has been collected by ticking the event loop and forcing GC
  await gcUntil(() => nativeTests.was_finalize_called());
};

nativeTests.test_napi_async_work_execute_null_check = () => {
  const res = nativeTests.create_async_work_with_null_execute();
  if (res) {
    console.log("success!");
  } else {
    console.log("failure!");
  }
};

nativeTests.test_napi_async_work_complete_null_check = async () => {
  nativeTests.create_async_work_with_null_complete();
  await gcUntil(() => true);
};

nativeTests.test_napi_async_work_cancel = () => {
  // UV_THREADPOOL_SIZE is set to 2, create two blocking tasks,
  // then create another and cancel it, ensuring the work is not
  // scheduled before `napi_cancel_async_work` is called
  const res = nativeTests.test_cancel_async_work(result => {
    if (result) {
      console.log("success!");
    } else {
      console.log("failure!");
    }
  });

  if (!res) {
    console.log("failure!");
  }
};

nativeTests.test_promise_with_threadsafe_function = async () => {
  await new Promise(resolve => setTimeout(resolve, 1));
  // create_promise_with_threadsafe_function returns a promise that calls our function from another
  // thread (via napi_threadsafe_function) and resolves with its return value
  return await nativeTests.create_promise_with_threadsafe_function(() => 1234);
};

nativeTests.test_get_exception = (_, value) => {
  function thrower() {
    throw value;
  }
  try {
    const result = nativeTests.call_and_get_exception(thrower);
    console.log("got same exception back?", result === value);
  } catch (e) {
    console.log("native module threw", typeof e, e);
    throw e;
  }
};

nativeTests.test_get_property = () => {
  const objects = [
    {},
    { foo: "bar" },
    {
      get foo() {
        throw new Error("get foo");
      },
    },
    {
      set foo(newValue) {},
    },
    new Proxy(
      {},
      {
        get(_target, key) {
          throw new Error(`proxy get ${key}`);
        },
      },
    ),
    5,
    "hello",
    null,
    undefined,
  ];
  const keys = [
    "foo",
    {
      toString() {
        throw new Error("toString");
      },
    },
    {
      [Symbol.toPrimitive]() {
        throw new Error("Symbol.toPrimitive");
      },
    },
    "toString",
    "slice",
  ];

  for (const object of objects) {
    for (const key of keys) {
      try {
        const ret = nativeTests.perform_get(object, key);
        console.log("native function returned", ret);
      } catch (e) {
        console.log("threw", e.name);
      }
    }
  }
};

nativeTests.test_set_property = () => {
  const objects = [
    {},
    { foo: "bar" },
    {
      set foo(value) {
        throw new Error(`set foo to ${value}`);
      },
    },
    {
      // getter but no setter
      get foo() {},
    },
    new Proxy(
      {},
      {
        set(_target, key, value) {
          throw new Error(`proxy set ${key} to ${value}`);
        },
      },
    ),
    null,
    undefined,
  ];
  const keys = [
    "foo",
    {
      toString() {
        throw new Error("toString");
      },
    },
    {
      [Symbol.toPrimitive]() {
        throw new Error("Symbol.toPrimitive");
      },
    },
  ];

  for (const object of objects) {
    for (const key of keys) {
      console.log(objects.indexOf(object) + ", " + keys.indexOf(key));
      try {
        const ret = nativeTests.perform_set(object, key, 42);
        console.log("native function returned", ret);
        if (object[key] != 42) {
          throw new Error("setting property did not throw an error, but the property was not actually set");
        }
      } catch (e) {
        console.log("threw", e.name);
      }
    }
  }
};

nativeTests.test_number_integer_conversions_from_js = () => {
  const i32 = { min: -(2 ** 31), max: 2 ** 31 - 1 };
  const u32Max = 2 ** 32 - 1;
  // this is not the actual max value for i64, but rather the highest double that is below the true max value
  const i64 = { min: -(2 ** 63), max: 2 ** 63 - 1024 };

  const i32Cases = [
    // special values
    [Infinity, 0],
    [-Infinity, 0],
    [NaN, 0],
    // normal
    [0.0, 0],
    [1.0, 1],
    [-1.0, -1],
    // truncation
    [1.25, 1],
    [-1.25, -1],
    // limits
    [i32.min, i32.min],
    [i32.max, i32.max],
    // wrap around
    [i32.min - 1.0, i32.max],
    [i32.max + 1.0, i32.min],
    [i32.min - 2.0, i32.max - 1],
    [i32.max + 2.0, i32.min + 1],
    // type errors
    ["5", undefined],
    [new Number(5), undefined],
  ];

  for (const [input, expectedOutput] of i32Cases) {
    const actualOutput = nativeTests.double_to_i32(input);
    console.log(`${input} as i32 => ${actualOutput}`);
    assert(actualOutput === expectedOutput);
  }

  const u32Cases = [
    // special values
    [Infinity, 0],
    [-Infinity, 0],
    [NaN, 0],
    // normal
    [0.0, 0],
    [1.0, 1],
    // truncation
    [1.25, 1],
    [-1.25, u32Max],
    // limits
    [u32Max, u32Max],
    // wrap around
    [-1.0, u32Max],
    [u32Max + 1.0, 0],
    [-2.0, u32Max - 1],
    [u32Max + 2.0, 1],
    // type errors
    ["5", undefined],
    [new Number(5), undefined],
  ];

  for (const [input, expectedOutput] of u32Cases) {
    const actualOutput = nativeTests.double_to_u32(input);
    console.log(`${input} as u32 => ${actualOutput}`);
    assert(actualOutput === expectedOutput);
  }

  const i64Cases = [
    // special values
    [Infinity, 0],
    [-Infinity, 0],
    [NaN, 0],
    // normal
    [0.0, 0],
    [1.0, 1],
    [-1.0, -1],
    // truncation
    [1.25, 1],
    [-1.25, -1],
    // limits
    [i64.min, i64.min],
    [i64.max, i64.max],
    // clamp
    [i64.min - 4096.0, i64.min],
    // this one clamps to the exact max value of i64 (2**63 - 1), which is then rounded
    // to exactly 2**63 since that's the closest double that can be represented
    [i64.max + 4096.0, 2 ** 63],
    // type errors
    ["5", undefined],
    [new Number(5), undefined],
  ];

  for (const [input, expectedOutput] of i64Cases) {
    const actualOutput = nativeTests.double_to_i64(input);
    console.log(
      `${typeof input == "number" ? input.toFixed(2) : input} as i64 => ${typeof actualOutput == "number" ? actualOutput.toFixed(2) : actualOutput}`,
    );
    assert(actualOutput === expectedOutput);
  }
};

nativeTests.test_create_array_with_length = () => {
  for (const size of [0, 5]) {
    const array = nativeTests.make_empty_array(size);
    console.log("length =", array.length);
    // should be 0 as array contains empty slots
    console.log("number of keys =", Object.keys(array).length);
  }
};

nativeTests.test_throw_functions_exhaustive = () => {
  for (const errorKind of ["error", "type_error", "range_error", "syntax_error"]) {
    for (const code of [undefined, "", "error code"]) {
      for (const msg of [undefined, "", "error message"]) {
        try {
          nativeTests.throw_error(code, msg, errorKind);
          console.log(`napi_throw_${errorKind}(${code ?? "nullptr"}, ${msg ?? "nullptr"}) did not throw`);
        } catch (e) {
          console.log(
            `napi_throw_${errorKind} threw ${e.name}: message ${JSON.stringify(e.message)}, code ${JSON.stringify(e.code)}`,
          );
        }
      }
    }
  }
};

nativeTests.test_create_error_functions_exhaustive = () => {
  for (const errorKind of ["error", "type_error", "range_error", "syntax_error"]) {
    // null (JavaScript null) is changed to nullptr by the native function
    for (const code of [undefined, null, "", 42, "error code"]) {
      for (const msg of [undefined, null, "", 42, "error message"]) {
        try {
          nativeTests.create_and_throw_error(code, msg, errorKind);
          console.log(
            `napi_create_${errorKind}(${code === null ? "nullptr" : code}, ${msg === null ? "nullptr" : msg}) did not make an error`,
          );
        } catch (e) {
          console.log(
            `create_and_throw_error(${errorKind}) threw ${e.name}: message ${JSON.stringify(e.message)}, code ${JSON.stringify(e.code)}`,
          );
        }
      }
    }
  }
};

nativeTests.test_type_tag = () => {
  const o1 = {};
  const o2 = {};

  nativeTests.add_tag(o1, 1, 2);

  try {
    // re-tag
    nativeTests.add_tag(o1, 1, 2);
  } catch (e) {
    console.log("tagging already-tagged object threw", e.toString());
  }

  console.log("tagging non-object succeeds: ", !nativeTests.try_add_tag(null, 0, 0));

  nativeTests.add_tag(o2, 3, 4);
  console.log("o1 matches o1:", nativeTests.check_tag(o1, 1, 2));
  console.log("o1 matches o2:", nativeTests.check_tag(o1, 3, 4));
  console.log("o2 matches o1:", nativeTests.check_tag(o2, 1, 2));
  console.log("o2 matches o2:", nativeTests.check_tag(o2, 3, 4));
};

nativeTests.test_napi_class = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  const instance = new NapiClass();
  console.log("static data =", NapiClass.getStaticData());
  console.log("static getter =", NapiClass.getter);
  console.log("foo =", instance.foo);
  console.log("data =", instance.getData());
};

nativeTests.test_subclass_napi_class = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  class Subclass extends NapiClass {}
  const instance = new Subclass();
  console.log("subclass static data =", Subclass.getStaticData());
  console.log("subclass static getter =", Subclass.getter);
  console.log("subclass foo =", instance.foo);
  console.log("subclass data =", instance.getData());
};

nativeTests.test_napi_class_non_constructor_call = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  console.log("non-constructor call NapiClass() =", NapiClass());
  console.log("global foo set to ", typeof foo != "undefined" ? foo : undefined);
};

nativeTests.test_reflect_construct_napi_class = () => {
  const NapiClass = nativeTests.get_class_with_constructor();
  let instance = Reflect.construct(NapiClass, [], Object);
  console.log("reflect constructed foo =", instance.foo);
  console.log("reflect constructed data =", instance.getData?.());
  class Foo {}
  instance = Reflect.construct(NapiClass, [], Foo);
  console.log("reflect constructed foo =", instance.foo);
  console.log("reflect constructed data =", instance.getData?.());
};

nativeTests.test_reflect_construct_no_prototype_crash = () => {
  // This test verifies the fix for jsDynamicCast being called on JSValue(0)
  // when a NAPI class constructor is called via Reflect.construct with a
  // newTarget that has no prototype property.

  const NapiClass = nativeTests.get_class_with_constructor();

  // Test 1: Constructor function with deleted prototype property
  // This case should work without crashing
  function ConstructorWithoutPrototype() {}
  delete ConstructorWithoutPrototype.prototype;

  try {
    const instance1 = Reflect.construct(NapiClass, [], ConstructorWithoutPrototype);
    console.log("constructor without prototype: success - no crash");
  } catch (e) {
    console.log("constructor without prototype error:", e.message);
  }

  // Test 2: Regular constructor (control test)
  // This should always work
  function NormalConstructor() {}

  try {
    const instance2 = Reflect.construct(NapiClass, [], NormalConstructor);
    console.log("normal constructor: success - no crash");
  } catch (e) {
    console.log("normal constructor error:", e.message);
  }

  // Test 3: Reflect.construct with Proxy newTarget (prototype returns undefined)
  function ProxyObject() {}

  const proxyTarget = new Proxy(ProxyObject, {
    get(target, prop) {
      if (prop === "prototype") {
        return undefined;
      }
      return target[prop];
    },
  });
  const instance3 = Reflect.construct(NapiClass, [], proxyTarget);
  console.log("✓ Success - no crash!");
};

nativeTests.test_napi_wrap = () => {
  const values = [
    {},
    {}, // should be able to be wrapped differently than the distinct empty object above
    5,
    new Number(5),
    "abc",
    new String("abc"),
    null,
    Symbol("abc"),
    Symbol.for("abc"),
    new (nativeTests.get_class_with_constructor())(),
    new Proxy(
      {},
      Object.fromEntries(
        [
          "apply",
          "construct",
          "defineProperty",
          "deleteProperty",
          "get",
          "getOwnPropertyDescriptor",
          "getPrototypeOf",
          "has",
          "isExtensible",
          "ownKeys",
          "preventExtensions",
          "set",
          "setPrototypeOf",
        ].map(name => [
          name,
          () => {
            throw new Error("oops");
          },
        ]),
      ),
    ),
  ];
  const wrapSuccess = Array(values.length).fill(false);
  for (const [i, v] of values.entries()) {
    wrapSuccess[i] = nativeTests.try_wrap(v, i + 1);
    console.log(`${typeof v} did wrap: `, wrapSuccess[i]);
  }

  for (const [i, v] of values.entries()) {
    if (wrapSuccess[i]) {
      if (nativeTests.try_unwrap(v) !== i + 1) {
        throw new Error("could not unwrap same value");
      }
    } else {
      if (nativeTests.try_unwrap(v) !== undefined) {
        throw new Error("value unwraps without being successfully wrapped");
      }
    }
  }
};

nativeTests.test_napi_wrap_proxy = () => {
  const target = {};
  const proxy = new Proxy(target, {});
  assert(nativeTests.try_wrap(target, 5));
  assert(nativeTests.try_wrap(proxy, 6));
  console.log(nativeTests.try_unwrap(target), nativeTests.try_unwrap(proxy));
};

nativeTests.test_napi_wrap_cross_addon = () => {
  const wrapped = {};
  console.log("wrap succeeds:", nativeTests.try_wrap(wrapped, 42));
  console.log("unwrapped from other addon", secondAddon.try_unwrap(wrapped));
};

nativeTests.test_napi_wrap_prototype = () => {
  class Foo {}
  console.log("wrap prototype succeeds:", nativeTests.try_wrap(Foo.prototype, 42));
  // wrapping should not look at prototype chain
  console.log("unwrap instance:", nativeTests.try_unwrap(new Foo()));
};

nativeTests.test_napi_remove_wrap = () => {
  const targets = [{}, new (nativeTests.get_class_with_constructor())()];
  for (const t of targets) {
    const target = {};
    // fails
    assert(nativeTests.try_remove_wrap(target) === undefined);
    // wrap it
    assert(nativeTests.try_wrap(target, 5));
    // remove yields the wrapped value
    assert(nativeTests.try_remove_wrap(target) === 5);
    // neither remove nor unwrap work anymore
    assert(nativeTests.try_unwrap(target) === undefined);
    assert(nativeTests.try_remove_wrap(target) === undefined);
    // can re-wrap
    assert(nativeTests.try_wrap(target, 6));
    assert(nativeTests.try_unwrap(target) === 6);
  }
};

// parameters to create_wrap are: object, ask_for_ref, strong
const createWrapWithoutRef = o => nativeTests.create_wrap(o, false, false);
const createWrapWithWeakRef = o => nativeTests.create_wrap(o, true, false);
const createWrapWithStrongRef = o => nativeTests.create_wrap(o, true, true);

nativeTests.test_wrap_lifetime_without_ref = async () => {
  let object = { foo: "bar" };
  assert(createWrapWithoutRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);
  object = undefined;
  await gcUntil(() => nativeTests.was_wrap_finalize_called());
};

nativeTests.test_wrap_lifetime_with_weak_ref = async () => {
  // this looks the same as test_wrap_lifetime_without_ref because it is -- these cases should behave the same
  let object = { foo: "bar" };
  assert(createWrapWithWeakRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);
  object = undefined;
  await gcUntil(() => nativeTests.was_wrap_finalize_called());
};

nativeTests.test_wrap_lifetime_with_strong_ref = async () => {
  let object = { foo: "bar" };
  assert(createWrapWithStrongRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);

  object = undefined;
  // still referenced by native module so this should fail
  try {
    await gcUntil(() => nativeTests.was_wrap_finalize_called());
    throw new Error("object was garbage collected while still referenced by native code");
  } catch (e) {
    if (!e.toString().includes("Condition was not met")) {
      throw e;
    }
  }

  // can still get the value using the ref
  assert(nativeTests.get_wrap_data_from_ref() === 42);

  // now we free it
  nativeTests.unref_wrapped_value();
  await gcUntil(() => nativeTests.was_wrap_finalize_called());
};

nativeTests.test_remove_wrap_lifetime_with_weak_ref = async () => {
  let object = { foo: "bar" };
  assert(createWrapWithWeakRef(object) === object);

  assert(nativeTests.get_wrap_data(object) === 42);

  nativeTests.remove_wrap(object);
  assert(nativeTests.get_wrap_data(object) === undefined);
  assert(nativeTests.get_wrap_data_from_ref() === undefined);
  assert(nativeTests.get_object_from_ref() === object);

  object = undefined;

  // ref will stop working once the object is collected
  await gcUntil(() => nativeTests.get_object_from_ref() === undefined);

  // finalizer shouldn't have been called
  assert(nativeTests.was_wrap_finalize_called() === false);
};

nativeTests.test_remove_wrap_lifetime_with_strong_ref = async () => {
  let object = { foo: "bar" };
  assert(createWrapWithStrongRef(object) === object);

  assert(nativeTests.get_wrap_data(object) === 42);

  nativeTests.remove_wrap(object);
  assert(nativeTests.get_wrap_data(object) === undefined);
  assert(nativeTests.get_wrap_data_from_ref() === undefined);
  assert(nativeTests.get_object_from_ref() === object);

  object = undefined;

  // finalizer should not be called and object should not be freed
  try {
    await gcUntil(() => nativeTests.was_wrap_finalize_called() || nativeTests.get_object_from_ref() === undefined);
    throw new Error("finalizer ran");
  } catch (e) {
    if (!e.toString().includes("Condition was not met")) {
      throw e;
    }
  }

  // native code can still get the object
  assert(JSON.stringify(nativeTests.get_object_from_ref()) === `{"foo":"bar"}`);

  // now it gets deleted
  nativeTests.unref_wrapped_value();
  await gcUntil(() => nativeTests.get_object_from_ref() === undefined);
};

nativeTests.test_ref_deleted_in_cleanup = () => {
  let object = { foo: "bar" };
  assert(createWrapWithWeakRef(object) === object);
  assert(nativeTests.get_wrap_data(object) === 42);
};

nativeTests.test_ref_deleted_in_async_finalize = () => {
  asyncFinalizeAddon.create_ref();
};

nativeTests.test_create_bigint_words = () => {
  console.log(nativeTests.create_weird_bigints());
};

nativeTests.test_get_value_string = () => {
  function to16Bit(string) {
    if (typeof Bun != "object") return string;
    const jsc = require("bun:jsc");
    const codeUnits = new DataView(new ArrayBuffer(2 * string.length));
    for (let i = 0; i < string.length; i++) {
      codeUnits.setUint16(2 * i, string.charCodeAt(i), true);
    }
    const decoder = new TextDecoder("utf-16le");
    const string16Bit = decoder.decode(codeUnits);
    // make sure we succeeded in making a UTF-16 string
    assert(jsc.jscDescribe(string16Bit).includes("8Bit:(0)"));
    return string16Bit;
  }
  function assert8Bit(string) {
    if (typeof Bun != "object") return string;
    const jsc = require("bun:jsc");
    // make sure we succeeded in making a Latin-1 string
    assert(jsc.jscDescribe(string).includes("8Bit:(1)"));
    return string;
  }
  // test all of our get_value_string_XXX functions on a variety of inputs
  for (const [string, description] of [
    ["hello", "simple latin-1"],
    [to16Bit("hello"), "16-bit encoded with only BMP characters"],
    [assert8Bit("café"), "8-bit with non-ascii characters"],
    [to16Bit("café"), "16-bit with non-ascii but latin-1 characters"],
    ["你好小圆面包", "16-bit, all BMP, all outside latin-1"],
    ["🐱🏳️‍⚧️", "16-bit with many surrogate pairs"],
    // TODO(@190n) handle these correctly
    // ["\ud801", "unpaired high surrogate"],
    // ["\udc02", "unpaired low surrogate"],
  ]) {
    console.log(`test napi_get_value_string on ${string} (${description})`);
    for (const encoding of ["latin1", "utf8", "utf16"]) {
      console.log(encoding);
      const fn = nativeTests[`test_get_value_string_${encoding}`];
      fn(string);
    }
  }
};

nativeTests.test_constructor_order = () => {
  require("./build/Debug/constructor_order_addon.node");
};

module.exports = nativeTests;
