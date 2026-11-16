"""Disposable end-to-end checks, pinned to the Chroma3D development project."""

import base64, bcrypt, hashlib, hmac, io, json, os, secrets, struct, subprocess, time, uuid, zipfile
from pathlib import Path
import requests

REF = "mbilemzzpoxdwujyswfk"
ORG = "pufuvmorvrnpwhrkdaqn"


def verify(execsql):
    env = dict(
        l.split("=", 1)
        for l in Path(".env.local").read_text().splitlines()
        if l and not l.startswith("#")
    )
    url = env["VITE_SUPABASE_URL"]
    assert url == "https://" + REF + ".supabase.co"
    key = env["VITE_SUPABASE_PUBLISHABLE_KEY"]
    run = uuid.uuid4()
    uid = lambda name: str(uuid.uuid5(run, name))
    dbq = lambda s: "'" + str(s).replace("'", "''") + "'"
    user, other, admin = [uid(n) for n in ["user", "other", "admin"]]
    prod, order, printid, studio, guest = [
        uid(n) for n in ["product", "order", "print", "studio", "guest"]
    ]
    three = uid("3mf")
    temporder = uid("unpaid")
    receipt = secrets.token_hex(32)
    othersecret = secrets.token_hex(32)
    password = secrets.token_urlsafe(28)
    hashpw = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()
    emails = {id: "qa-" + id + "@example.invalid" for id in (user, other, admin)}

    def http(method, path, status=None, tok=None, **kwargs):
        h = {"apikey": key}
        h.update(kwargs.pop("headers", {}))
        if tok:
            h["Authorization"] = "Bearer " + tok
        r = requests.request(method, url + path, headers=h, timeout=50, **kwargs)
        if status is not None and r.status_code not in (
            status if isinstance(status, tuple) else (status,)
        ):
            try:
                body = r.json()
                reason = (
                    body.get("error_description")
                    or body.get("msg")
                    or body.get("message")
                    or body.get("error")
                    or str(list(body))[:80]
                )
            except:
                reason = "non-JSON response"
            raise RuntimeError(
                (method, path.split("?")[0], r.status_code, status, reason)
            )
        return r

    def edge(data, tok=None, status=200, files=None):
        kwargs = (
            {"json": data}
            if not files
            else {
                "data": {"data": json.dumps(data)},
                "files": [("file", (n, b, m)) for n, b, m in files],
            }
        )
        return http("POST", "/functions/v1/chroma-api", status, tok, **kwargs).json()

    def rest(table, query="", tok=None):
        return http("GET", "/rest/v1/" + table + "?" + query, 200, tok).json()

    def login(id):
        return http(
            "POST",
            "/auth/v1/token?grant_type=password",
            200,
            json={"email": emails[id], "password": password},
        ).json()["access_token"]

    def totp(secret):
        key = base64.b32decode(secret.upper() + "=" * ((8 - len(secret) % 8) % 8))
        s = hmac.new(
            key, struct.pack(">Q", int(time.time()) // 30), hashlib.sha1
        ).digest()
        o = s[-1] & 15
        return str((int.from_bytes(s[o : o + 4], "big") & 0x7FFFFFFF) % 1000000).zfill(
            6
        )

    def ok(msg):
        print("PASS", msg, flush=True)

    def js(v):
        return dbq(json.dumps(v)) + "::jsonb"

    def simple(d):
        return hashlib.sha256(d.encode()).hexdigest()

    png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8FcAAAAASUVORK5CYII="
    )
    stl = (
        b"\0" * 80
        + struct.pack("<I", 1)
        + struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0)
    )
    fileSTL = [("fixture.stl", stl, "application/octet-stream")]
    u = v = a = None
    try:
        values = ",".join(
            "("
            + ",".join(
                [
                    dbq("00000000-0000-0000-0000-000000000000"),
                    dbq(id),
                    "'authenticated'",
                    "'authenticated'",
                    dbq(mail),
                    dbq(hashpw),
                    "now()",
                    "'{}'",
                    "'{}'",
                    "now()",
                    "now()",
                    "''",
                    "''",
                    "''",
                    "''",
                ]
            )
            + ")"
            for id, mail in emails.items()
        )
        execsql(
            "insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,recovery_token,email_change_token_new) values "
            + values
            + ";insert into private.admin_members(user_id) values("
            + dbq(admin)
            + ");select 1 as ok"
        )
        u, v, a = map(login, (user, other, admin))
        assert (
            http("POST", "/rest/v1/rpc/admin_access", 200, u, json={}).json()
            == "denied"
        )
        assert (
            http("POST", "/rest/v1/rpc/admin_access", 200, a, json={}).json()
            == "mfa_required"
        )
        edge({"action": "cleanup"}, u, 403)
        edge({"action": "cleanup"}, a, 403)
        edge({"action": "cleanup"}, None, 403)
        mfa = http(
            "POST",
            "/auth/v1/factors",
            200,
            a,
            json={"factor_type": "totp", "friendly_name": "fixture"},
        ).json()
        factor = mfa["id"]
        challenge = http(
            "POST", "/auth/v1/factors/" + factor + "/challenge", 200, a, json={}
        ).json()["id"]
        a = http(
            "POST",
            "/auth/v1/factors/" + factor + "/verify",
            200,
            a,
            json={"challenge_id": challenge, "code": totp(mfa["totp"]["secret"])},
        ).json()["access_token"]
        assert (
            http("POST", "/rest/v1/rpc/admin_access", 200, a, json={}).json() == "admin"
        )
        ok("real Auth identities, MFA sign-in, anonymous/non-admin/AAL1 denied")
        cat = rest("categories", "select=id", a)[0]["id"]
        slug = "qa-" + prod
        sku = "qa-" + prod
        name = "Verification sample"
        # Insert through the same authenticated column grant used by the admin editor.
        p = http(
            "POST",
            "/rest/v1/products",
            201,
            a,
            headers={"Prefer": "return=representation"},
            json={
                "name": name,
                "slug": slug,
                "description": "Temporary integration fixture",
                "category_id": cat,
                "sample": True,
            },
        ).json()[0]
        prod = p["id"]
        http(
            "PATCH",
            "/rest/v1/products?id=eq." + prod,
            204,
            a,
            json={"description": "Edited temporary verification specimen"},
        )
        assert rest("products", "id=eq." + prod) == []
        variants = http(
            "POST",
            "/rest/v1/variants",
            201,
            a,
            headers={"Prefer": "return=representation"},
            json=[
                dict(
                    product_id=prod,
                    format=f,
                    sku=sku + f,
                    price_minor=pr,
                    available=True,
                )
                for f, pr in [("stl", 15350), ("print", 67890)]
            ],
        ).json()
        assetVariant = next(i["id"] for i in variants if i["format"] == "stl")
        edge(
            {
                "action": "admin-file",
                "bucket": "draft-media",
                "id": prod,
                "primary": True,
                "alt": "QA pixel",
                "position": 0,
            },
            a,
            files=[("fixture.png", png, "image/png")],
        )
        edge(
            {
                "action": "admin-file",
                "bucket": "digital-products",
                "id": assetVariant,
                "version": 1,
            },
            a,
            files=fileSTL,
        )
        edge({"action": "publish", "id": prod, "status": "published"}, a)
        pub = rest(
            "products",
            "id=eq."
            + prod
            + "&select=slug,sample,variants(format,price_minor),product_media(path)",
        )
        assert pub[0]["sample"] is True and len(pub[0]["variants"]) == 2
        imgpath = pub[0]["product_media"][0]["path"]
        assert (
            http(
                "GET", "/storage/v1/object/public/product-media/" + imgpath, 200
            ).content
            == png
        )
        path = rest("digital_assets", "variant_id=eq." + assetVariant, a)[0]["path"]
        assert (
            http(
                "GET", "/storage/v1/object/public/digital-products/" + path
            ).status_code
            != 200
            and http(
                "GET",
                "/storage/v1/object/authenticated/digital-products/" + path,
                tok=v,
            ).status_code
            != 200
        )
        links = edge({"action": "preview-listing", "id": prod}, a)["urls"]
        assert requests.get(links[imgpath], timeout=15).content == png
        edge({"action": "preview-listing", "id": prod}, u, 403)
        ok(
            "draft isolation, MFA listing preview, publish, variants, public image/private STL"
        )
        spec = {
            "material": "PLA",
            "colour": "Graphite",
            "finish": "Standard",
            "quantity": 3,
            "inspected_bounds": "1 x 1 x 1 mm",
        }

        def form(id, k, s):
            return {
                "id": id,
                "kind": k,
                "action": "submit",
                "receipt": receipt,
                "name": "Verification",
                "email": emails[user],
                "title": "Test fixture",
                "specification": s,
            }

        data = form(printid, "print", spec)
        edge(data, u, 400, files=[("bad.stl", b"short", "application/octet-stream")])
        edge(data, u, 201, files=fileSTL)
        edge(data, u, 201, files=fileSTL)
        edge(dict(data, title="Changed"), u, 409, files=fileSTL)
        assert len(rest("requests", "id=eq." + printid, u)) == 1 and not rest(
            "requests", "id=eq." + printid, v
        )
        assert http("GET", "/rest/v1/requests?id=eq." + printid).status_code in (
            401,
            403,
        )

        def act(id, k, action="read", **kw):
            return dict(id=id, kind=k, action=action, **kw)

        edge(act(printid, "print", receipt=othersecret), v, 404)
        edge(act(printid, "print", receipt=receipt), v, 404)
        with subprocess.Popen(
            ["node", "supabase/tests/realtime.mjs"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        ) as realtime:
            realtime.stdin.write(
                json.dumps(dict(url=url, key=key, owner=u, other=v, id=printid))
            )
            realtime.stdin.close()
            assert realtime.stdout.readline().strip() == "ready"
            edge(act(printid, "print", "advance", status="review"), a)
            assert (
                realtime.stdout.readline().strip() == "verified"
                and realtime.wait(timeout=10) == 0
            )
        ok(
            "Realtime delivered a request update to its owner and isolated the unrelated customer"
        )
        estimate = {
            "action": "estimate",
            "id": printid,
            "grams": 12.5,
            "estimate_minor": 2700,
        }
        edge(estimate, u, 403)
        edge(estimate, a)
        reviewed = edge(act(printid, "print"), u)["record"]
        assert (
            float(reviewed["material_grams"]) == 12.5
            and reviewed["material_cost_minor"] == 1250
            and reviewed["estimated_minor"] == 2700
        )
        edge(
            act(
                printid,
                "print",
                "advance",
                status="note",
                note="private QA note",
                internal=True,
            ),
            a,
        )
        edge(
            act(
                printid,
                "print",
                "advance",
                status="quoted",
                amount_minor=10000,
                valid_until="2099-01-01T00:00:00Z",
            ),
            a,
        )
        edge(act(printid, "print", "advance", status="accepted"), u)
        assert not any(h["internal"] for h in edge(act(printid, "print"), u)["history"])
        assert (
            rest("pricing_settings", "material=eq.PLA", a)[0]["cost_minor_per_kg"]
            == 100000
        )
        assert len(
            rest("request_files", "request_id=eq." + printid, u)
        ) == 1 and not rest("request_files", "request_id=eq." + printid, v)
        edge(
            form(
                studio,
                "studio",
                {
                    "idea": "Test a small enclosure",
                    "requirements": "20 mm",
                    "reference": "",
                },
            ),
            u,
            201,
            files=[("ref.png", png, "image/png")],
        )
        edge(form(guest, "studio", {"idea": "Guest studio QA fixture"}), None, 201)
        assert edge(act(guest, "studio", receipt=receipt))["record"]["owner_id"] is None
        edge(act(guest, "studio", receipt=othersecret), None, 404)
        for s in ["review", "discussion", "revision"]:
            edge(act(studio, "studio", "advance", status=s), a)
        edge(
            {
                "action": "admin-file",
                "id": studio,
                "bucket": "studio-files",
                "purpose": "revision",
            },
            a,
            files=[("revision.png", png, "image/png")],
        )
        rev = next(
            f["id"]
            for f in edge(act(studio, "studio"), u)["files"]
            if f["purpose"] == "revision"
        )
        edge(
            act(studio, "studio", "advance", status="awaiting_approval", file_id=rev), a
        )
        edge(
            act(studio, "studio", "advance", status="approved", file_id=uid("wrong")),
            u,
            409,
        )
        edge(act(studio, "studio", "advance", status="approved", file_id=rev), u)
        edge(act(studio, "studio", "request-file", file_id=rev), v, 404)
        signed = edge(act(studio, "studio", "request-file", file_id=rev), u)[
            "signedUrl"
        ]
        assert requests.get(signed, timeout=15).content == png
        ok(
            "persistent print and studio uploads, pricing parameter, quotes, notes, guest receipts, row/file isolation, revision-specific approval"
        )
        # Temporarily allow this fixture inside ONE transaction. It is never visible to customers as genuine inventory.
        body = {
            "kind": "order",
            "name": "Verification",
            "email": emails[user],
            "items": [{"variant_id": assetVariant, "quantity": 1, "price_minor": 1}],
            "total_minor": 1,
        }

        def submit(id, body):
            return (
                "public.submit_work("
                + ",".join(
                    [
                        dbq(id),
                        dbq(simple(receipt)),
                        dbq(simple(json.dumps(body))),
                        dbq(user),
                        js(body),
                        "'[]'",
                    ]
                )
                + ")"
            )

        check = execsql(
            "update public.products set sample=false where id="
            + dbq(prod)
            + ";select "
            + submit(order, body)
            + ";select "
            + submit(order, body)
            + ";update public.products set sample=true where id="
            + dbq(prod)
            + ";select total_minor from public.orders where id="
            + dbq(order)
        )
        assert check[0]["total_minor"] == 15350
        assert (
            not rest("orders", "id=eq." + order, v)
            and len(rest("order_items", "order_id=eq." + order, u)) == 1
        )
        edge(act(order, "order", "download", file_id=uid("fake")), u, 409)
        edge(dict(body, id=temporder, action="submit", receipt=receipt), u, 409)
        edge(
            dict(
                body,
                id=temporder,
                action="submit",
                receipt=receipt,
                items=[{"variant_id": assetVariant, "quantity": 0}],
            ),
            u,
            400,
        )
        assert rest("orders", "id=eq." + order, u)[0]["payment_status"] == "unpaid"
        http(
            "PATCH",
            "/rest/v1/variants?id=eq." + assetVariant,
            204,
            a,
            json={"price_minor": 45400},
        )
        assert rest("order_items", "order_id=eq." + order, u)[0]["unit_minor"] == 15350
        execsql(
            "select private.record_verified_payment("
            + dbq(order)
            + ","
            + dbq("qa-" + order)
            + ",15350,'INR');select 1 as ok"
        )
        downloads = edge(act(order, "order"), u)["downloads"]
        assert len(downloads) == 1
        edge(act(order, "order", "download", file_id=downloads[0]["id"]), v, 404)
        digital = edge(act(order, "order", "download", file_id=downloads[0]["id"]), u)[
            "signedUrl"
        ]
        assert requests.get(digital, timeout=15).content == stl
        ok(
            "order idempotency/snapshot, invalid quantity/sample rejected, unpaid delivery denied, trusted payment fixture and authorized download"
        )
        edge({"action": "publish", "id": prod, "status": "draft"}, a)
        assert rest("products", "id=eq." + prod) == []
        edge({"action": "publish", "id": prod, "status": "archived"}, a)
        assert rest("products", "id=eq." + prod) == []
        assert not execsql(
            "select 1 from storage.objects where bucket_id='product-media' and name="
            + dbq(imgpath)
        )
        ok("unpublication, archive and public origin copy removal")
        bio = io.BytesIO()
        with zipfile.ZipFile(bio, "w") as z:
            z.writestr(
                "[Content_Types].xml",
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
            )
            z.writestr(
                "_rels/.rels",
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
            )
            z.writestr(
                "3D/3dmodel.model",
                '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter" xml:lang="en"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>',
            )
        edge(
            form(three, "print", spec),
            u,
            201,
            files=[("fixture.3mf", bio.getvalue(), "application/octet-stream")],
        )
        time.sleep(67)
        assert (
            requests.get(
                digital + "&qa=expiry",
                headers={"Cache-Control": "no-cache"},
                timeout=15,
            ).status_code
            != 200
        )
        ok("signed digital URL expired on hosted Storage")
    finally:
        ids = [prod, studio, printid, guest, three] + (
            [assetVariant] if "assetVariant" in locals() else []
        )
        permitted = ",".join(dbq(x) for x in ids)
        objects = execsql(
            "select bucket_id,name from storage.objects where split_part(name,'/',1) in ("
            + permitted
            + ")"
        )
        if objects and a:
            policy = "qa_" + run.hex
            predicate = (
                "((select auth.uid())="
                + dbq(admin)
                + "::uuid and split_part(name,'/',1) in ("
                + permitted
                + "))"
            )
            execsql(
                "create policy "
                + policy
                + "r on storage.objects for select to authenticated using "
                + predicate
                + ";create policy "
                + policy
                + "d on storage.objects for delete to authenticated using "
                + predicate
                + ";select 1 as ok"
            )
            try:
                for bucket in {o["bucket_id"] for o in objects}:
                    http(
                        "DELETE",
                        "/storage/v1/object/" + bucket,
                        200,
                        a,
                        json={
                            "prefixes": [
                                o["name"] for o in objects if o["bucket_id"] == bucket
                            ]
                        },
                    )
            finally:
                execsql(
                    "drop policy "
                    + policy
                    + "r on storage.objects;drop policy "
                    + policy
                    + "d on storage.objects;select 1 as ok"
                )
        if a:
            http("POST", "/auth/v1/logout", 204, a)
        for tok in (u, v):
            if tok:
                http("POST", "/auth/v1/logout", 204, tok)
        ids = (
            "("
            + ",".join(
                dbq(x) for x in [order, temporder, studio, guest, printid, three]
            )
            + ")"
        )
        statements = [
            "delete from private.download_audit where entitlement_id in (select e.id from private.entitlements e join public.order_items i on i.id=e.item_id where i.order_id in "
            + ids
            + ")",
            "delete from private.entitlements where item_id in (select id from public.order_items where order_id in "
            + ids
            + ")",
            *[
                "delete from " + t + " where order_id in " + ids
                for t in ["private.payments", "public.order_items"]
            ],
            "delete from public.orders where id in " + ids,
            "delete from public.requests where id in " + ids,
            "delete from private.receipts where id in " + ids,
            "delete from private.notifications where entity_id in " + ids,
            "delete from public.upload_intents where split_part(path,'/',1) in ("
            + permitted
            + ")",
            "delete from public.digital_assets where variant_id in (select id from public.variants where product_id="
            + dbq(prod)
            + ")",
            "delete from public.products where id=" + dbq(prod),
            "delete from auth.users where id in ("
            + ",".join(dbq(x) for x in (user, other, admin))
            + ")",
        ]
        execsql(";".join(statements) + ";select 1 as ok")
        ok("QA identities, records and objects removed")


if __name__ == "__main__":
    if os.environ.get("CHROMA_TEST_PROJECT") != REF:
        raise SystemExit("Set CHROMA_TEST_PROJECT to the development project ref.")
    headers = {"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"]}
    base = "https://api.supabase.com/v1/projects/" + REF
    project = requests.get(base, headers=headers, timeout=30)
    project.raise_for_status()
    if (
        project.json().get("organization_id") != ORG
        or project.json().get("name") != "chroma3d-dev"
    ):
        raise SystemExit("Wrong development project")

    def query(sql):
        result = requests.post(
            base + "/database/query", headers=headers, json={"query": sql}, timeout=60
        )
        if not result.ok:
            raise RuntimeError("Fixture SQL failed: HTTP " + str(result.status_code))
        return result.json()

    verify(query)
